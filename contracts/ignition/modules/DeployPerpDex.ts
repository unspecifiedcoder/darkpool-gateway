import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "hardhat";
import "dotenv/config";

// --- Configuration ---
const INITIAL_BTC_PRICE = ethers.parseUnits("100000", 18);
const ORACLE_UPDATER_ADDRESS = process.env.ORACLE_UPDATER_ADDRESS || "";

const FullDexModule = buildModule("FullDexModule", (m) => {
  if (ORACLE_UPDATER_ADDRESS === "") {
    throw new Error("ORACLE_UPDATER_ADDRESS must be set in your .env file.");
  }

  // --- 1. Deploy Core Contracts ---
  const usdcToken = m.contract("MockERC20", ["USD Coin", "USDC"]);
  const oracle = m.contract("Oracle", [INITIAL_BTC_PRICE]);
  
  // --- 2. Deploy Faucet & ClearingHouse (which depend on core contracts) ---
  const publicFaucet = m.contract("PublicFaucet", [usdcToken]);
  const clearingHouse = m.contract("ClearingHouse", [oracle, usdcToken]);

  console.log("✅ All contracts configured for deployment.");

  // --- 3. Configure All Permissions After Deployment ---
  console.log("⚙️  Configuring roles...");
  
  // Calculate role hashes once for clarity and efficiency
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const UPDATER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("UPDATER_ROLE"));

  // Grant MINTER_ROLE to the ClearingHouse for profit/fee payouts
  m.call(usdcToken, "grantRole", [MINTER_ROLE, clearingHouse]);
  console.log("   - Granting MINTER_ROLE to ClearingHouse...");

  // Grant MINTER_ROLE to the PublicFaucet for user token requests
  m.call(usdcToken, "grantRole", [MINTER_ROLE, publicFaucet]);
  console.log("   - Granting MINTER_ROLE to PublicFaucet...");
  
  // Grant UPDATER_ROLE on the Oracle to the off-chain bot address
  m.call(oracle, "grantRole", [UPDATER_ROLE, ORACLE_UPDATER_ADDRESS]);
  console.log(`   - Granting UPDATER_ROLE to ${ORACLE_UPDATER_ADDRESS}...`);

  return { usdcToken, oracle, clearingHouse, publicFaucet };
});

export default FullDexModule;