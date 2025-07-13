import { ethers } from "hardhat";
import { expect } from "chai";
import {
  PrivacyProxy, MockERC20,
  ClearingHouseV2,
  TokenPool,
} from "../typechain-types";
import { EventLog, formatUnits } from "ethers";
import path from "path";
import fs from "fs";
import { UserClient } from "./UserClient"; // Import our new client
import { LeanIMT } from "../test/dark-pool/test_utils/leanIMT";
import { calculateSolidityCommitment, generate_precommitment } from "../test/dark-pool/utils/utils";
import { generateWithdrawTransferProof } from "../test/dark-pool/utils/proofGeneration";

// --- CONFIGURATION ---
const parseUSDC = (amount: string) => ethers.parseUnits(amount, 18);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const log = (step: number, message: string) => console.log(`\n\n====================\n--- STEP ${step}: ${message} ---\n====================`);
const sublog = (message: string) => console.log(`    - ${message}`);

async function main() {
  log(0, "Setting up environment and contracts...");
  const [deployer, eoaTriffiny, eoaJay] = await ethers.getSigners();
  
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const deploymentInfoPath = path.join(__dirname, "..", "ignition", "deployments", `chain-${chainId}`, "deployed_addresses.json");
  if (!fs.existsSync(deploymentInfoPath)) throw new Error("❌ Deployment info not found!");
  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentInfoPath, "utf-8"));
  const getAddress = (name: string) => deploymentInfo[Object.keys(deploymentInfo).find(k => k.endsWith(`#${name}`))!];

  const privacyProxy: PrivacyProxy = await ethers.getContractAt("PrivacyProxy", getAddress("PrivacyProxy"));
  const tokenPool: TokenPool = await ethers.getContractAt("TokenPool", getAddress("TokenPool"));
  const clearingHouse: ClearingHouseV2 = await ethers.getContractAt("ClearingHouseV2", getAddress("ClearingHouseV2"));
  const usdcToken: MockERC20 = await ethers.getContractAt("MockERC20", getAddress("MockERC20"));
  
  const tsTree = new LeanIMT(32);

  const triffiny = await UserClient.create(eoaTriffiny);
  const jay = await UserClient.create(eoaJay);
  
  await usdcToken.connect(deployer).mint(triffiny.signer.address, parseUSDC("50000"));
  await usdcToken.connect(deployer).mint(jay.signer.address, parseUSDC("1000"));
  sublog("Contracts loaded and test users initialized.");

  // =================================================
  // == STEP 1: TRIFFINY ONBOARDS INTO THE DARK POOL ==
  // =================================================
  log(1, "Triffiny onboards into the Dark Pool by making her first deposit.");
  await triffiny.fetchAndSetMetadata();
  expect(triffiny.currentMetadata?.commitment_info).to.be.null;
  sublog("Verified: Indexer has no initial metadata for Triffiny.");

  const depositAmount = parseUSDC("20000");
  const nullifier = triffiny.getNextNullifier();
  const secret = triffiny.getSecret();
  const precommitment = await generate_precommitment(nullifier, secret);
  
  await usdcToken.connect(triffiny.signer).approve(getAddress("TokenPool"), depositAmount);
  const depositTx = await tokenPool.connect(triffiny.signer).deposit(depositAmount, precommitment.toString());
  
  sublog("Waiting for deposit confirmation and parsing event...");
  const receipt = await depositTx.wait();
  // Correctly parse leafIndex from the event emitted by the contract
  const depositEvent = receipt?.logs.find(l => l.address === getAddress("TokenPool") && l.topics[0] === ethers.id("CommitmentInserted(bytes32,uint32,bytes32)")) as EventLog;
  const leafIndex = depositEvent.args[1];
  sublog(`Deposit successful. New commitment inserted at leaf index: ${leafIndex}`);
  
  // Update client state and post to server
  triffiny.updateCommitment(depositAmount.toString(), leafIndex);
  await triffiny.postMetadata();

  // =======================================================
  // == STEP 2: VERIFY INITIAL STATE AND FUND PROXY ACCOUNT ==
  // =======================================================
  log(2, "Verifying Triffiny's initial state and funding her trading account.");
  expect(await triffiny.getOpenPositions()).to.be.empty;
  expect(await triffiny.getHistoricalPositions()).to.be.empty;
  expect(await triffiny.getUnspentNotes()).to.be.empty;
  sublog("Verified via API: Triffiny has no positions or notes.");
  
  sublog("Funding proxy with 5,000 USDC directly from EOA...");
  await usdcToken.connect(triffiny.signer).approve(getAddress("PrivacyProxy"), parseUSDC("5000"));
  await privacyProxy.connect(triffiny.signer).depositCollateralFromEOA(triffiny.pubKey, parseUSDC("5000"));
  
  sublog("Funding proxy with 10,000 USDC from Dark Pool balance...");
  await triffiny.fetchAndSetMetadata(); // ALWAYS fetch latest state before an action
  
  const currentCommitment = triffiny.getCommitmentInfo();
  const dpWithdrawAmount = parseUSDC("10000");
  const remainingValue = BigInt(currentCommitment.value) - dpWithdrawAmount;
  const newNullifier = triffiny.getNextNullifier();
  
  // Update local tree to generate proof against correct root
  tsTree.insert(await calculateSolidityCommitment(nullifier, secret, depositAmount, await usdcToken.getAddress()));
  
  const { proof, publicInputs } = await generateWithdrawTransferProof(
    nullifier.toString(), secret.toString(), currentCommitment.value, await usdcToken.getAddress(),
    currentCommitment.leafIndex.toString(), tsTree.getRoot().toString(), newNullifier.toString(), secret.toString(),
    dpWithdrawAmount.toString(), tsTree.getPath(currentCommitment.leafIndex).map(x => x.toString())
  );
  
  const dpTx = await privacyProxy.connect(triffiny.signer).depositCollateralFromDarkPool(triffiny.pubKey, { honkProof: proof, publicInputs });
  const dpReceipt = await dpTx.wait();
  
  const dpEvent = dpReceipt?.logs.find(l => l.address === getAddress("TokenPool") && l.topics[0] === ethers.id("CommitmentInserted(bytes32,uint32,bytes32)")) as EventLog;
  const newLeafIndex = dpEvent.args[1];
  sublog(`Dark Pool withdrawal approved. New commitment for remaining funds at leaf: ${newLeafIndex}`);
  
  // Update local tree with new state, then update client state and post to server
  tsTree.insert(await calculateSolidityCommitment(newNullifier, secret, remainingValue, await usdcToken.getAddress()));
  triffiny.updateCommitment(remainingValue.toString(), newLeafIndex);
  await triffiny.postMetadata();
  
  // =======================================================
  // == STEP 3: TRIFFINY OPENS MULTIPLE POSITIONS
  // =======================================================
  log(3, "Triffiny opens four separate positions using her private collateral.");
  
  const positionsToOpen = [
    { id: ethers.randomBytes(32), margin: parseUSDC("1500"), leverage: 2000n, isLong: true, desc: "20x Long" },
    { id: ethers.randomBytes(32), margin: parseUSDC("1000"), leverage: 4000n, isLong: true, desc: "40x Long" },
    { id: ethers.randomBytes(32), margin: parseUSDC("1500"), leverage: 2000n, isLong: false, desc: "20x Short" },
    { id: ethers.randomBytes(32), margin: parseUSDC("1000"), leverage: 4000n, isLong: false, desc: "40x Short" },
  ];

  for (const pos of positionsToOpen) {
    const msgHash = ethers.solidityPackedKeccak256(
      ["string", "bytes32", "uint256", "uint256", "bool"],
      ["OPEN_POSITION", pos.id, pos.margin, pos.leverage, pos.isLong]
    );
    const signature = await triffiny.secretWallet.signMessage(ethers.getBytes(msgHash));
    await privacyProxy.connect(triffiny.signer).openPosition(triffiny.pubKey, pos.id, pos.margin, pos.leverage, pos.isLong, signature);
    sublog(`Opened ${pos.desc} with ${formatUnits(pos.margin, 18)} USDC margin.`);
  }

  await sleep(3000); // Give indexer time to catch up
  const openPositions = await triffiny.getOpenPositions();
  expect(openPositions.length).to.equal(4);
  sublog(`Verified via API: Indexer now shows Triffiny has 4 open positions.`);
}

main().catch((error) => {
  console.error("❌ Scenario failed!", error);
  process.exitCode = 1;
});