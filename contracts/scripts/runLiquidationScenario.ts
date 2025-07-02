// scripts/runLiquidationScenario.ts
import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import { ClearingHouse, Oracle, MockERC20 } from "../typechain-types";

// --- Configuration ---
const SCENARIO_CONFIG = {
  // Use high leverage to make positions sensitive to price changes
  LEVERAGE: 50n * 100n, // 50x
  MARGIN_AMOUNT: ethers.parseUnits("200", 18), // 200 USDC margin
  INITIAL_MINT_AMOUNT: ethers.parseUnits("1000", 18), // 1000 USDC for each trader
  // How much the price changes each tick (e.g., 0.005 is 0.5%)
  PRICE_VOLATILITY_PERCENT: 0.5,
  // Delay between simulation ticks in milliseconds
  TICK_DELAY_MS: 4000,
};

// Helper function for delays
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  console.log("🚀 Starting the Liquidation Scenario Runner...");

  // --- 1. Get Contracts and Signers ---
  const [deployer, alice, bob] = await ethers.getSigners();
  // const deployer = signers[18]
  const chainId = (await ethers.provider.getNetwork()).chainId;

  // Load deployed contract addresses from Ignition
  const deploymentInfoPath = path.join(__dirname, "..", "ignition", "deployments", `chain-${chainId}`, "deployed_addresses.json");
  if (!fs.existsSync(deploymentInfoPath)) {
    throw new Error("❌ Deployment info not found. Deploy contracts first!");
  }
  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentInfoPath, "utf-8"));
  
  const getAddress = (name: string) => {
    const key = Object.keys(deploymentInfo).find(k => k.endsWith(`#${name}`));
    if (!key) throw new Error(`Contract ${name} not found in deployment info.`);
    return deploymentInfo[key];
  };

  const clearingHouse: ClearingHouse = await ethers.getContractAt("ClearingHouse", getAddress("ClearingHouse"));
  const oracle: Oracle = await ethers.getContractAt("Oracle", getAddress("Oracle"));
  const usdcToken: MockERC20 = await ethers.getContractAt("MockERC20", getAddress("MockERC20"));

  console.log("✅ Contracts attached successfully.");

  // --- 2. Setup Phase: Create Risky Positions ---
  console.log("\n--- 셋업 PHASE: Preparing Trader Positions ---");
  const traders = {
    "Alice (LONG)": { signer: alice, isLong: true },
    "Bob (SHORT)": { signer: bob, isLong: false },
  };
  const activePositions = new Set<string>([alice.address, bob.address]);

  for (const [name, trader] of Object.entries(traders)) {
    console.log(`\nSetting up ${name}...`);
    // Mint, approve, and deposit collateral
    await usdcToken.connect(deployer).mint(trader.signer.address, SCENARIO_CONFIG.INITIAL_MINT_AMOUNT);
    await usdcToken.connect(trader.signer).approve(await clearingHouse.getAddress(), ethers.MaxUint256);
    await clearingHouse.connect(trader.signer).depositCollateral(SCENARIO_CONFIG.INITIAL_MINT_AMOUNT);
    console.log(`   - Deposited ${ethers.formatUnits(SCENARIO_CONFIG.INITIAL_MINT_AMOUNT, 18)} USDC`);

    // Open high-leverage position
    await clearingHouse.connect(trader.signer).openPosition(
      SCENARIO_CONFIG.MARGIN_AMOUNT,
      SCENARIO_CONFIG.LEVERAGE,
      trader.isLong
    );
    console.log(`   - Opened ${ethers.formatUnits(SCENARIO_CONFIG.MARGIN_AMOUNT, 18)} USDC position at ${SCENARIO_CONFIG.LEVERAGE / 100n}x leverage`);
  }

  // --- 3. Event Listener for Liquidations ---
  clearingHouse.on(clearingHouse.filters.PositionLiquidated, (user, liquidator, fee) => {
    console.log("\n----------------------------------------------------");
    console.log(`💥 LIQUIDATION EVENT!`);
    console.log(`   - User:       ${user}`);
    console.log(`   - Liquidator: ${liquidator}`);
    console.log(`   - Fee Paid:   ${ethers.formatUnits(fee, 18)} USDC`);
    console.log("----------------------------------------------------\n");
    activePositions.delete(user);
  });
  
  console.log("\n--- SIMULATION PHASE: Manipulating Price ---");
  console.log("👂 Now listening for liquidations. Run your bots!");

  // --- 4. Simulation Loop ---
  while (activePositions.size > 0) {
    await sleep(SCENARIO_CONFIG.TICK_DELAY_MS);
    console.log(`\n--- Tick [${new Date().toLocaleTimeString()}] ---`);

    // Print PnL for active positions
    for (const address of activePositions) {
      const name = address === alice.address ? "Alice (LONG)" : "Bob (SHORT)";
      try {
        const [pnl, isSolvent] = await clearingHouse.calculatePnl(address);
        console.log(`   - 💰 ${name}: PnL: ${ethers.formatUnits(pnl, 18).substring(0, 8)} USDC | Solvent: ${isSolvent}`);
      } catch (e) {
        // Position might have been closed/liquidated since we last checked
        console.log(`   - 💰 ${name}: Position no longer exists.`);
      }
    }

    // Manipulate the price
    let currentPrice = await oracle.getPrice();
    let priceChangeBps = BigInt(Math.floor(SCENARIO_CONFIG.PRICE_VOLATILITY_PERCENT * 100)); // e.g., 0.5% -> 50 BPS

    // Strategy: Push price down to liquidate Alice (long), then up to liquidate Bob (short)
    if (activePositions.has(alice.address)) {
      console.log("   - 📉 Pushing price DOWN to target LONG position...");
      currentPrice = (currentPrice * (10000n - priceChangeBps)) / 10000n;
    } else if (activePositions.has(bob.address)) {
      console.log("   - 📈 Pushing price UP to target SHORT position...");
      currentPrice = (currentPrice * (10000n + priceChangeBps)) / 10000n;
    }

    // The deployer (who has UPDATER_ROLE) updates the price
    // await oracle.connect(deployer).setPrice(currentPrice);
    // console.log(`   - 🔔 Oracle price updated to: $${ethers.formatUnits(currentPrice, 18)}`);
  }

  console.log("\n--- 🎉 SIMULATION COMPLETE: All positions have been liquidated. ---");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});