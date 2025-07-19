import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "hardhat";
import "dotenv/config";

// --- Configuration ---
const INITIAL_BTC_PRICE = ethers.parseUnits("100000", 18);
let ORACLE_UPDATER_ADDRESS = process.env.ORACLE_UPDATER_ADDRESS || "0x6d86AfD96b1091B52c95784B5a3a1Bd5cB614188";
ethers.provider.getNetwork().then((network) => {
  if (network.name === "localhost") {
    ORACLE_UPDATER_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // hardhat first account
  }
  console.log("Oracle Updater Address: ", ORACLE_UPDATER_ADDRESS);
});

const TOKEN_POOL_TREE_DEPTH = 32;

const PrivacyDexModule = buildModule("PrivacyDexModule", (m) => {
  // We'll use the deployer account as the mock "EntryPoint" for managing the TokenPool
  const entryPoint = m.getAccount(0);

  // --- 1. DEPLOY STANDALONE LIBRARIES & VERIFIERS ---
  console.log("🚀 Deploying ZK and Library dependencies...");
  const poseidon2Lib = m.contract("Poseidon2");
  const withdrawVerifier = m.contract("WithdrawTransferHonkVerifier");
  const claimVerifier = m.contract("ClaimHonkVerifier");
  console.log("   - Poseidon2 & ZK Verifiers configured.");

  // --- 2. DEPLOY CORE FUNCTIONAL CONTRACTS ---
  console.log("🚀 Deploying Core Contracts...");
  const usdcToken = m.contract("MockERC20", ["USD Coin", "USDC"]);
  const oracle = m.contract("Oracle", [INITIAL_BTC_PRICE]);
  console.log("   - MockERC20 & Oracle configured.");

  // --- 3. DEPLOY V2 APPLICATION-LAYER CONTRACTS ---
  console.log("🚀 Deploying Application Logic Contracts...");
  const clearingHouse = m.contract("ClearingHouseV2", [oracle, usdcToken]);
  
  // Deploy TokenPool, linking the Poseidon2 library
  const tokenPool = m.contract(
    "TokenPool",
    [entryPoint, usdcToken, withdrawVerifier, claimVerifier, TOKEN_POOL_TREE_DEPTH],
    {
      libraries: {
        Poseidon2: poseidon2Lib,
      },
    }
  );
  console.log("   - ClearingHouseV2 & TokenPool configured.");

  // --- 4. DEPLOY THE PRIVACY PROXY ---
  console.log("🚀 Deploying the Privacy Proxy...");
  const privacyProxy = m.contract("PrivacyProxy", [clearingHouse, tokenPool]);
  console.log("   - PrivacyProxy configured.");

  // --- 4.5 Deploy Public Faucet ---
  console.log("🚀 Deploying the Public Faucet...");
  const publicFaucet = m.contract("PublicFaucet", [usdcToken]);
  console.log("   - PublicFaucet configured.");

  // --- 5. CONFIGURE PERMISSIONS (POST-DEPLOYMENT) ---
  console.log("⚙️  Configuring contract roles and permissions...");

  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const UPDATER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("UPDATER_ROLE"));

  // Grant MINTER_ROLE to the ClearingHouse for settling profitable trades and to the PublicFaucet for minting USDC
  m.call(usdcToken, "grantRole", [MINTER_ROLE, clearingHouse], {
    id: "GrantMinterToClearingHouse",
  });
  console.log("   - Granting MINTER_ROLE to ClearingHouse...");
  m.call(usdcToken, "grantRole", [MINTER_ROLE, publicFaucet], {
    id: "GrantMinterToPublicFaucet",
  });
  console.log("   - Granting MINTER_ROLE to PublicFaucet...");

  // Grant UPDATER_ROLE on the Oracle to the off-chain bot
  m.call(oracle, "grantRole", [UPDATER_ROLE, ORACLE_UPDATER_ADDRESS], {
    id: "GrantUpdaterToBot",
  });
  console.log(`   - Granting UPDATER_ROLE to ${ORACLE_UPDATER_ADDRESS}...`);
  
  console.log("✅ Full Privacy DEX infrastructure deployment configured successfully!");

  return {
    usdcToken,
    oracle,
    clearingHouse,
    tokenPool,
    privacyProxy,
    withdrawVerifier,
    claimVerifier,
    publicFaucet,
  };
});

export default PrivacyDexModule;