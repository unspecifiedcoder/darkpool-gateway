import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "hardhat";
import "dotenv/config";

// --- Configuration ---
const INITIAL_BTC_PRICE = ethers.parseUnits("100000", 18);
const ORACLE_UPDATER_ADDRESS = process.env.ORACLE_UPDATER_ADDRESS || "0x6d86AfD96b1091B52c95784B5a3a1Bd5cB614188";

// Note: I'm renaming the module to FullDexModule to match the filename
const FullDexModule = buildModule("FullDexModule", (m) => {
  if (ORACLE_UPDATER_ADDRESS === "") {
    throw new Error("ORACLE_UPDATER_ADDRESS must be set in your .env file.");
  }

  // --- 1. Deploy Core Contracts ---
  const usdcToken = m.contract("MockERC20", ["USD Coin", "USDC"]);
  const oracle = m.contract("Oracle", [INITIAL_BTC_PRICE]);
  
  // --- 2. Deploy Faucet & ClearingHouse ---
  const publicFaucet = m.contract("PublicFaucet", [usdcToken]);
  const clearingHouse = m.contract("ClearingHouseV2", [oracle, usdcToken]); // clearing house v2

  console.log("✅ All contracts configured for deployment.");

  // --- 3. Configure All Permissions ---
  console.log("⚙️  Configuring roles...");
  
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const UPDATER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("UPDATER_ROLE"));

  // --- FIX: Provide unique IDs for each `grantRole` call on the same contract ---

  // Grant MINTER_ROLE to the ClearingHouse
  m.call(usdcToken, "grantRole", [MINTER_ROLE, clearingHouse], {
    id: "GrantMinterRoleToClearingHouse", // Unique ID
  });
  console.log("   - Granting MINTER_ROLE to ClearingHouse...");

  // Grant MINTER_ROLE to the PublicFaucet
  m.call(usdcToken, "grantRole", [MINTER_ROLE, publicFaucet], {
    id: "GrantMinterRoleToFaucet", // Unique ID
  });
  console.log("   - Granting MINTER_ROLE to PublicFaucet...");
  
  // Grant UPDATER_ROLE on the Oracle
  m.call(oracle, "grantRole", [UPDATER_ROLE, ORACLE_UPDATER_ADDRESS], {
    id: "GrantUpdaterRoleToBot", // Good practice to be consistent
  });
  console.log(`   - Granting UPDATER_ROLE to ${ORACLE_UPDATER_ADDRESS}...`);

  return { usdcToken, oracle, clearingHouse, publicFaucet };
});

export default FullDexModule;