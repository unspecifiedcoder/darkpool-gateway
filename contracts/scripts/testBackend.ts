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
import { generateClaimProof, generateWithdrawTransferProof } from "../test/dark-pool/utils/proofGeneration";
import { Fr } from "@aztec/foundation/fields";

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
  
  // const tsTree = new LeanIMT(32);

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
  triffiny.updateCommitment(depositAmount.toString(), Number(leafIndex));
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
  
  
  
  const { proof, publicInputs } = await generateWithdrawTransferProof(
    nullifier.toString(), secret.toString(), currentCommitment.value, await usdcToken.getAddress(),
    currentCommitment.leafIndex.toString(), (await tokenPool.currentRoot()), newNullifier.toString(), secret.toString(),
    dpWithdrawAmount.toString(), await tokenPool.getPath(currentCommitment.leafIndex)
  );
  
  const dpTx = await privacyProxy.connect(triffiny.signer).depositCollateralFromDarkPool(triffiny.pubKey, { honkProof: proof, publicInputs });
  const dpReceipt = await dpTx.wait();
  
  const dpEvent = dpReceipt?.logs.find(l => l.address === getAddress("TokenPool") && l.topics[0] === ethers.id("CommitmentInserted(bytes32,uint32,bytes32)")) as EventLog;
  const tokenPoolInterface = tokenPool.interface;
  const parsedLog = tokenPoolInterface.parseLog({
    data: dpEvent!.data,
    topics: dpEvent!.topics.map((topic) => topic.toString()),
  });
  const newLeafIndex = Number(parsedLog!.args[1]);
  sublog(`Dark Pool withdrawal approved. New commitment for remaining funds at leaf: ${newLeafIndex}`);
  
  triffiny.updateCommitment(remainingValue.toString(), newLeafIndex);
  await triffiny.postMetadata();
  
  // =======================================================
  // == STEP 3: TRIFFINY OPENS MULTIPLE POSITIONS
  // =======================================================
  log(3, "Triffiny opens four separate positions using her private collateral.");
  
  const positionsToOpen = [
    { id: ethers.randomBytes(32), margin: parseUSDC("1500"), leverage: 2000n, isLong: true, desc: "20x Long" },
    { id: ethers.randomBytes(32), margin: parseUSDC("1000"), leverage: 3800n, isLong: true, desc: "38x Long" },
    { id: ethers.randomBytes(32), margin: parseUSDC("1500"), leverage: 2000n, isLong: false, desc: "20x Short" },
    { id: ethers.randomBytes(32), margin: parseUSDC("1000"), leverage: 3800n, isLong: false, desc: "38x Short" },
  ];

  for (const pos of positionsToOpen) {
    const msgHash = ethers.solidityPackedKeccak256(
      ["string", "bytes32", "uint256", "uint256", "bool"],
      ["OPEN_POSITION", pos.id, pos.margin, pos.leverage, pos.isLong]
    );
    const signature = await triffiny.secretWallet.signMessage(ethers.getBytes(msgHash));
    await (await privacyProxy.connect(triffiny.signer).openPosition(triffiny.pubKey, pos.id, pos.margin, pos.leverage, pos.isLong, signature)).wait();
    sublog(`Opened ${pos.desc} with ${formatUnits(pos.margin, 18)} USDC margin.`);
  }

  await sleep(11000); // Give indexer time to catch up
  const openPositions = await triffiny.getOpenPositions();
  expect(openPositions.length).to.equal(4);
  sublog(`Verified via API: Indexer now shows Triffiny has 4 open positions.`);

  // =======================================================
  // == STEP 4: TRIFFINY CLOSES TWO POSITIONS
  // =======================================================
  log(4, "Triffiny closes two of her four positions...");
  
  // Note: For a real-world scenario, we'd wait for an oracle price update.
  // Here, we can assume the price is the same, so one position will have a small loss from fees.
  
  const positionsToClose = openPositions.slice(0, 2); // Close the first two
  
  for (const pos of positionsToClose) {
    const posIdBytes = ethers.getBytes(pos.position_id);
    const msgHash = ethers.solidityPackedKeccak256(["string", "bytes32"], ["CLOSE_POSITION", posIdBytes]);
    const signature = await triffiny.secretWallet.signMessage(ethers.getBytes(msgHash));
    await (await privacyProxy.connect(triffiny.signer).closePosition(posIdBytes, signature)).wait();
    sublog(`Closed position ${pos.position_id.slice(0, 10)}...`);
  }

  await sleep(11000); // Give indexer time to catch up
  
  const currentOpenPositions = await triffiny.getOpenPositions();
  expect(currentOpenPositions.length).to.equal(2);
  sublog(`Verified via API: Triffiny now has 2 open positions.`);
  
  const historicalPositions = await triffiny.getHistoricalPositions();
  expect(historicalPositions.length).to.equal(2);
  expect(historicalPositions[0].status).to.equal("Closed");
  sublog(`Verified via API: Triffiny has 2 historical positions.`);

  // =======================================================
  // == STEP 5: JAY SENDS A PRIVATE NOTE TO TRIFFINY
  // =======================================================
  log(5, "Jay sends a private note of 500 USDC to Triffiny...");
  
  // Jay makes a deposit to get a commitment in the pool
  const jayDepositAmount = parseUSDC("1000");
  await usdcToken.connect(jay.signer).approve(getAddress("TokenPool"), jayDepositAmount);
  const jayNullifier = jay.getNextNullifier();
  const jaySecret = jay.getSecret();
  const jayPrecommitment = await generate_precommitment(jayNullifier, jaySecret);
  const jayDepositTx = await tokenPool.connect(jay.signer).deposit(jayDepositAmount, jayPrecommitment.toString());
  const jayReceipt = await jayDepositTx.wait();
  const jayDepositEvent = jayReceipt?.logs.find(l => l.address === getAddress("TokenPool") && l.topics[0] === ethers.id("CommitmentInserted(bytes32,uint32,bytes32)")) as EventLog;
  const jayLeafIndex = Number(jayDepositEvent.args[1]);
  
  // Jay generates a proof to transfer 500 USDC to Triffiny's receiverHash
  const noteAmount = parseUSDC("500");
  const jayRemainingValue = jayDepositAmount - noteAmount;
  const jayNewNullifier = jay.getNextNullifier();
  
  const { proof: transferProof, publicInputs: transferPI } = await generateWithdrawTransferProof(
    jayNullifier.toString(), jaySecret.toString(), jayDepositAmount.toString(), await usdcToken.getAddress(),
    jayLeafIndex.toString(), await tokenPool.currentRoot(), jayNewNullifier.toString(), jaySecret.toString(),
    noteAmount.toString(), await tokenPool.getPath(jayLeafIndex)
  );
  
  await (await tokenPool.connect(jay.signer).transfer({ honkProof: transferProof, publicInputs: transferPI },  triffiny.receiverHash.toString())).wait();
  sublog(`Jay completed the private transfer transaction.`);

  const jayNoteId = ethers.solidityPackedKeccak256(
    ["address", "uint256"],
    [usdcToken.target.toString(), (await tokenPool.noteNonce()) - 1n]
  );

  console.log("Jay's note ID:", jayNoteId , "encoded data is" , ethers.solidityPacked(
    ["address", "uint256"],
    [usdcToken.target.toString(), (await tokenPool.noteNonce()) - 1n]
  ));
  
  const jayNote = await tokenPool.notes(jayNoteId);
  console.log("Jay's note:", jayNote);
  expect(jayNote.value).to.equal(noteAmount.toString());
  expect(jayNote.receiverHash).to.equal(triffiny.receiverHash.toString());
  sublog(`Verified via API: Jay sees 1 unspent note intended for her.`);
  // Update local tree for next proof
  
  await sleep(11000);
  let triffinyNotes = await triffiny.getUnspentNotes();
  expect(triffinyNotes.length).to.equal(1);
  console.log("Triffiny's notes:", triffinyNotes);
  expect(triffinyNotes[0].value).to.equal(noteAmount.toString());
  sublog(`Verified via API: Triffiny sees 1 unspent note intended for her.`);

  // =======================================================
  // == STEP 6: TRIFFINY CLOSES ALL POSITIONS AND WITHDRAWS TO DARK POOL
  // =======================================================
  log(6, "Triffiny closes her remaining positions and withdraws all funds to the Dark Pool...");
  
  const remainingPositions = await triffiny.getOpenPositions();
  for (const pos of remainingPositions) {
    const posIdBytes = ethers.getBytes(pos.position_id);
    const msgHash = ethers.solidityPackedKeccak256(["string", "bytes32"], ["CLOSE_POSITION", posIdBytes]);
    const signature = await triffiny.secretWallet.signMessage(ethers.getBytes(msgHash));
    await (await privacyProxy.connect(triffiny.signer).closePosition(posIdBytes, signature)).wait();
    sublog(`Closed final position ${pos.position_id.slice(0, 10)}...`);
  }

  // Wait for indexer and then get final collateral balance from the proxy
  await sleep(11000);
  const finalProxyBalance = await privacyProxy.userFreeCollateral(triffiny.pubKey);
  sublog(`Triffiny's final reconciled collateral in Proxy: ${formatUnits(finalProxyBalance, 18)} USDC`);
  expect(finalProxyBalance).to.be.gt(0);
  
  // Withdraw this entire balance back to the dark pool as a new note for herself
  const msgHash = ethers.solidityPackedKeccak256(
    ["string", "uint256", "bytes32"],
    ["WITHDRAW_COLLATERAL", finalProxyBalance, triffiny.receiverHash.toString()]
  );
  const signature = await triffiny.secretWallet.signMessage(ethers.getBytes(msgHash));
  await (await privacyProxy.connect(triffiny.signer).withdrawCollateralToDarkPool(triffiny.pubKey, finalProxyBalance,  triffiny.receiverHash.toString(), signature)).wait();
  sublog("Withdrawal from Proxy to Dark Pool complete.");

  await sleep(11000);
  triffinyNotes = await triffiny.getUnspentNotes();
  expect(triffinyNotes.length).to.equal(2);
  sublog(`Verified via API: Triffiny now has 2 unspent notes.`);
  
  
  // --- This is the end of the simulation. The "claim" flow would be the next logical step,
  // --- but is a separate, complex test case focusing solely on the ZK proofs for claiming notes.
  // --- This script has successfully validated the entire lifecycle from onboarding to trading and exiting.

  // console.log("\n✅ Backend Test Scenario Completed Successfully!");
    // =======================================================
  // == STEP 7: TRIFFINY CLAIMS HER NOTES TO CONSOLIDATE HER BALANCE
  // =======================================================
  log(7, "Triffiny claims her two unspent notes to consolidate her private balance...");

  triffinyNotes = await triffiny.getUnspentNotes();
  expect(triffinyNotes.length).to.equal(2);
  
  // We will claim the notes one by one, merging them into our existing dark pool commitment.
  for (const noteToClaim of triffinyNotes) {
    sublog(`Preparing to claim note with nonce ${noteToClaim.note_nonce} and value ${formatUnits(noteToClaim.value, 18)} USDC...`);
    
    // ALWAYS fetch latest metadata before a ZK action
    await triffiny.fetchAndSetMetadata();
    const currentCommitment = triffiny.getCommitmentInfo();
    const currentSecret = triffiny.getSecret();
    const currentNullifier = BigInt(ethers.solidityPackedKeccak256(["bytes32", "uint256"], [triffiny.secretWallet.privateKey, triffiny.currentMetadata.last_used_nullifier_nonce])) % Fr.MODULUS;


    // The new balance will be the sum of her current private balance and the note's value
    const newConsolidatedValue = BigInt(currentCommitment.value) + BigInt(noteToClaim.value);
    const newConsolidatedNullifier = triffiny.getNextNullifier();

    const { proof: claimProof, publicInputs: claimPI } = await generateClaimProof(
      noteToClaim.note_nonce.toString(),
      noteToClaim.value,
      currentNullifier.toString(),
      currentSecret.toString(),
      currentCommitment.value,
      await usdcToken.getAddress(),
      currentCommitment.leafIndex.toString(),
      await tokenPool.currentRoot(),
      newConsolidatedNullifier.toString(),
      currentSecret.toString(), // Secret remains the same for the new commitment
      triffiny.receiverSecret.toString(),
      triffiny.receiverHash.toString(),
      await tokenPool.getPath(currentCommitment.leafIndex)
    );

    const claimTx = await tokenPool.connect(triffiny.signer).claim({ honkProof: claimProof, publicInputs: claimPI });
    const claimReceipt = await claimTx.wait();
    
    const claimEvent = claimReceipt?.logs.find(l => l.address === getAddress("TokenPool") && l.topics[0] === ethers.id("CommitmentInserted(bytes32,uint32,bytes32)")) as EventLog;
    
    const newLeafIndex = Number(claimEvent.args[1]);
    sublog(`Claim successful. New consolidated commitment at leaf index: ${newLeafIndex}`);

    // Update client state with the new consolidated balance and post to server
    triffiny.updateCommitment(newConsolidatedValue.toString(), newLeafIndex);
    await triffiny.postMetadata();
  }

  await sleep(6000);
  triffinyNotes = await triffiny.getUnspentNotes();
  expect(triffinyNotes.length).to.equal(0);
  sublog("Verified via API: Triffiny has no more unspent notes.");

  // =======================================================
  // == STEP 8: TRIFFINY WITHDRAWS EVERYTHING BACK TO HER EOA
  // =======================================================
  log(8, "Triffiny performs a final withdrawal of her entire consolidated balance to her EOA...");

  await triffiny.fetchAndSetMetadata();
  const finalCommitment = triffiny.getCommitmentInfo();
  const finalSecret = triffiny.getSecret();
  const finalNullifier = BigInt(ethers.solidityPackedKeccak256(["bytes32", "uint256"], [triffiny.secretWallet.privateKey, triffiny.currentMetadata.last_used_nullifier_nonce])) % Fr.MODULUS;

  const finalWithdrawAmount = BigInt(finalCommitment.value);
  const exitNullifier = triffiny.getNextNullifier();

  // The new commitment will have zero value as she is exiting completely
  const { proof: finalProof, publicInputs: finalPI } = await generateWithdrawTransferProof(
    finalNullifier.toString(),
    finalSecret.toString(),
    finalWithdrawAmount.toString(),
    await usdcToken.getAddress(),
    finalCommitment.leafIndex.toString(),
    await tokenPool.currentRoot(),
    exitNullifier.toString(),
    finalSecret.toString(),
    finalWithdrawAmount.toString(),
    await tokenPool.getPath(finalCommitment.leafIndex)
  );

  const triffinyEOABalanceBefore = await usdcToken.balanceOf(triffiny.signer.address);
  sublog(`Triffiny's EOA balance before final withdrawal: ${formatUnits(triffinyEOABalanceBefore, 18)} USDC`);

  await (await tokenPool.connect(triffiny.signer).withdraw(triffiny.signer.address, { honkProof: finalProof, publicInputs: finalPI })).wait();
  sublog(`Final withdrawal transaction sent and confirmed.`);

  const triffinyEOABalanceAfter = await usdcToken.balanceOf(triffiny.signer.address);
  sublog(`Triffiny's EOA balance after final withdrawal: ${formatUnits(triffinyEOABalanceAfter, 18)} USDC`);

  expect(triffinyEOABalanceAfter).to.equal(triffinyEOABalanceBefore + finalWithdrawAmount);

  // Final state update
  triffiny.updateCommitment("0", 0); // Reset her commitment info
  triffiny.currentMetadata!.commitment_info = null; // Or set to null
  await triffiny.postMetadata();

  console.log("\n✅✅✅ Full End-to-End System Test Completed Successfully! ✅✅✅");

}

main().catch((error) => {
  console.error("❌ Scenario failed!", error);
  process.exitCode = 1;
});