// scripts/runLiquidationScenario.ts
import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import { ClearingHouse, Oracle, MockERC20 } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// --- Configuration ---
const TRADER_CONFIG = [
  // IMR (1.67%) < MMR (6.25%) -> Instantly Liquidated
  { name: "Alice (Insta-Liq LONG)", isLong: true, leverage: 60n * 100n },
  // IMR (1.67%) < MMR (6.25%) -> Instantly Liquidated
  { name: "Bob (Insta-Liq SHORT)", isLong: false, leverage: 60n * 100n },
  // IMR (6.67%) > MMR (6.25%) -> Highly Vulnerable
  { name: "Charlie (Vulnerable LONG)", isLong: true, leverage: 158n * 10n },
  // IMR (6.67%) > MMR (6.25%) -> Highly Vulnerable
  { name: "David (Vulnerable SHORT)", isLong: false, leverage: 158n * 10n },
  // IMR (33.3%) >> MMR (6.25%) -> Safe
  { name: "Ellie (Safe LONG)", isLong: true, leverage: 3n * 100n },
  // IMR (33.3%) >> MMR (6.25%) -> Safe
  { name: "Filip (Safe SHORT)", isLong: false, leverage: 3n * 100n },
];

const SCENARIO_CONFIG = {
  INITIAL_BTC_PRICE: ethers.parseUnits("108000", 18),
  MARGIN_AMOUNT: ethers.parseUnits("1000", 18),
  INITIAL_MINT_AMOUNT: ethers.parseUnits("2000", 18),
  PRICE_VOLATILITY_BPS: 50n, // 0.5% price change per tick
  TICK_DELAY_MS: 5000,
};

// --- Helper Functions ---
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function getFormattedPositionInfo(
  clearingHouse: ClearingHouse,
  oracle: Oracle,
  trader: HardhatEthersSigner,
  MMR_BPS: bigint,
  PRICE_PRECISION: bigint
): Promise<string> {
  try {
    const position = await clearingHouse.positions(trader.address);
    if (position.size === 0n) {
      return "Position closed/liquidated.";
    }

    const [pnl, isSolvent] = await clearingHouse.calculatePnl(trader.address);
    const currentPrice = await oracle.getPrice();

    // Calculate the liquidation buffer
    const totalEquity = position.margin + pnl;
    const positionValue = (position.size * currentPrice) / PRICE_PRECISION;
    const requiredMargin = (positionValue * MMR_BPS) / 10000n;
    const bufferUSDC = totalEquity - requiredMargin;

    // Calculate the price change resistance percentage
    let priceResistancePercent = "0.00";
    if (bufferUSDC > 0n && position.size > 0n) {
      const priceDiff = (bufferUSDC * PRICE_PRECISION) / position.size;
      const resistance = (Number(priceDiff * 10000n / currentPrice) / 100).toFixed(2);
      priceResistancePercent = resistance;
    }

    const pnlStr = ethers.formatUnits(pnl, 18);
    const bufferStr = ethers.formatUnits(bufferUSDC < 0 ? 0 : bufferUSDC, 18);

    return `PnL: ${pnlStr.substring(0, pnlStr.indexOf('.') + 3).padEnd(8)} | Buffer: ${bufferStr.substring(0, bufferStr.indexOf('.') + 3).padEnd(6)} USDC (~${priceResistancePercent.padStart(5)}%) | Solvent: ${isSolvent}`;
  } catch (e) {
    return "Position no longer exists.";
  }
}

// --- Main Execution ---
async function main() {
  console.log("🚀 Starting the Multi-Agent Liquidation Scenario...");

  // Get Contracts and Signers
  const signers = await ethers.getSigners();
  if (signers.length < 7) throw new Error("Need at least 7 accounts for this scenario");
  const [deployer, ...traderSigners] = signers;

  // ... (contract loading logic is the same)
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const deploymentInfoPath = path.join(__dirname, "..", "ignition", "deployments", `chain-${chainId}`, "deployed_addresses.json");
  if (!fs.existsSync(deploymentInfoPath)) throw new Error("❌ Deployment info not found!");
  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentInfoPath, "utf-8"));
  const getAddress = (name: string) => { const key = Object.keys(deploymentInfo).find(k => k.endsWith(`#${name}`)); if (!key) throw new Error(`Contract ${name} not found`); return deploymentInfo[key]; };
  const clearingHouse: ClearingHouse = await ethers.getContractAt("ClearingHouse", getAddress("ClearingHouse"));
  const oracle: Oracle = await ethers.getContractAt("Oracle", getAddress("Oracle"));
  const usdcToken: MockERC20 = await ethers.getContractAt("MockERC20", getAddress("MockERC20"));
  
  // await oracle.connect(deployer).setPrice(SCENARIO_CONFIG.INITIAL_BTC_PRICE);
  // console.log(`✅ Contracts attached. Initial BTC Price set to $${ethers.formatUnits(SCENARIO_CONFIG.INITIAL_BTC_PRICE, 18)}`);
  
  // Get contract constants once
  const MMR_BPS = await clearingHouse.MAINTENANCE_MARGIN_RATIO_BPS();
  const PRICE_PRECISION = await clearingHouse.PRICE_PRECISION();

  // Setup Trader Positions
  console.log("\n--- SETUP PHASE: Preparing Trader Positions ---");
  const traderMap = new Map<string, { name: string, signer: HardhatEthersSigner }>();
  const activePositions = new Set<string>();

  for (let i = 0; i < TRADER_CONFIG.length; i++) {
    const config = TRADER_CONFIG[i];
    const signer = traderSigners[i];
    traderMap.set(signer.address, { name: config.name, signer });
    activePositions.add(signer.address);

    console.log(`\nSetting up ${config.name}...`);
    await usdcToken.connect(deployer).mint(signer.address, SCENARIO_CONFIG.INITIAL_MINT_AMOUNT);
    await usdcToken.connect(signer).approve(await clearingHouse.getAddress(), ethers.MaxUint256);
    await clearingHouse.connect(signer).depositCollateral(SCENARIO_CONFIG.INITIAL_MINT_AMOUNT);
    await clearingHouse.connect(signer).openPosition(SCENARIO_CONFIG.MARGIN_AMOUNT, config.leverage, config.isLong);
    console.log(`   - Opened position with ${ethers.formatUnits(SCENARIO_CONFIG.MARGIN_AMOUNT, 18)} USDC at ${config.leverage / 100n}x leverage`);
  }

  // Event Listener & Simulation Loop
  clearingHouse.on(clearingHouse.filters.PositionLiquidated, (user) => {
    const trader = traderMap.get(user);
    console.log(`\n🚨🚨🚨 LIQUIDATION CONFIRMED: ${trader?.name || user} has been liquidated! 🚨🚨🚨\n`);
    activePositions.delete(user);
  });
  
  console.log("\n--- SIMULATION PHASE: Manipulating Price ---");
  console.log("👂 Now listening for liquidations. Run your bots!");

  while (activePositions.size > 2) { // Loop until only safe traders are left
    await sleep(SCENARIO_CONFIG.TICK_DELAY_MS);
    console.log(`\n--- Tick [${new Date().toLocaleTimeString()}] ---`);

    for (const address of activePositions) {
      const traderInfo = traderMap.get(address)!;
      const statusLine = await getFormattedPositionInfo(clearingHouse, oracle, traderInfo.signer, MMR_BPS, PRICE_PRECISION);
      console.log(`   - ${traderInfo.name.padEnd(25)} | ${statusLine}`);
    }

    // Manipulate the price
    let currentPrice = await oracle.getPrice();
    let targetExists = false;
    const charlieAddress = traderSigners[2].address;
    const davidAddress = traderSigners[3].address;

    if (activePositions.has(charlieAddress)) {
      console.log("\n   - 🎯 Targeting vulnerable LONG (Charlie). Pushing price DOWN...");
      currentPrice = (currentPrice * (10000n - SCENARIO_CONFIG.PRICE_VOLATILITY_BPS)) / 10000n;
      targetExists = true;
    } else if (activePositions.has(davidAddress)) {
      console.log("\n   - 🎯 Targeting vulnerable SHORT (David). Pushing price UP...");
      currentPrice = (currentPrice * (10000n + SCENARIO_CONFIG.PRICE_VOLATILITY_BPS)) / 10000n;
      targetExists = true;
    }

    // if (targetExists) {
    //     await oracle.connect(deployer).setPrice(currentPrice);
    //     console.log(`   - 🔔 Oracle price updated to: $${ethers.formatUnits(currentPrice, 18)}`);
    // }
  }

  console.log("\n--- 🎉 SIMULATION COMPLETE: All vulnerable positions have been liquidated. ---");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});