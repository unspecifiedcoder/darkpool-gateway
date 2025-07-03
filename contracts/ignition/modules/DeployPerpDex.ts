import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "hardhat";
import "dotenv/config";

// ========== CONFIGURATION ==========
// The initial price of BTC in USDC, with 18 decimals. E.g., $50,000
const INITIAL_BTC_PRICE = ethers.parseUnits("100000", 18);

// The public address for your off-chain bot that will update the oracle price.
// This is loaded from your .env file. # hardhat account 19
const ORACLE_UPDATER_ADDRESS = process.env.ORACLE_UPDATER_ADDRESS || "0x6d86AfD96b1091B52c95784B5a3a1Bd5cB614188";
// ===================================

const PerpDexModule = buildModule("PerpDexModule", (m) => {
  // Validate that the oracle updater address is set
  if (ORACLE_UPDATER_ADDRESS === "") {
    throw new Error("ORACLE_UPDATER_ADDRESS is not set in your .env file.");
  }

  console.log("Deploying Contracts....");

  // Step 1: Deploy the MockERC20 (USDC) contract
  const usdcToken = m.contract("MockERC20", ["USD Coin", "USDC"]);
  console.log("MockERC20 (USDC) deployment configured.");
  

  // Step 2: Deploy the Oracle contract with an initial price
  const oracle = m.contract("Oracle", [INITIAL_BTC_PRICE]);
  console.log(`Oracle deployment configured with initial price: ${ethers.formatUnits(INITIAL_BTC_PRICE, 18)}`);

  // Step 3: Deploy the ClearingHouse, linking the Oracle and USDC token
  const clearingHouse = m.contract("ClearingHouse", [
    oracle,
    usdcToken,
  ]);
  console.log("ClearingHouse deployment configured.");

  // Step 4: Configure permissions after deployments are complete.
  
  // Grant the MINTER_ROLE on the USDC token to the ClearingHouse.
  // This allows the ClearingHouse to mint USDC to pay out profits.
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  m.call(usdcToken, "grantRole", [MINTER_ROLE, clearingHouse]);
  console.log("Granting MINTER_ROLE to ClearingHouse configured.");


  // Grant the UPDATER_ROLE on the Oracle to our off-chain bot address.
  // This allows the bot to submit new prices.
  const UPDATER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("UPDATER_ROLE"));
  m.call(oracle, "grantRole", [UPDATER_ROLE, ORACLE_UPDATER_ADDRESS]);
  console.log(`Granting UPDATER_ROLE to ${ORACLE_UPDATER_ADDRESS} configured.`);


  // Return the deployed contract instances for easy access
  return { usdcToken, oracle, clearingHouse };
});

export default PerpDexModule;