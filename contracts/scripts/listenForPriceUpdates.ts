import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import { Oracle } from "../typechain-types"; // Import the type for better autocompletion

async function main() {
  console.log("🚀 Starting the Oracle event listener...");

  // --- 1. Get the deployed contract address from Ignition ---
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const deploymentInfoPath = path.join(
    __dirname,
    "..", // Go up from scripts directory to project root
    "ignition",
    "deployments",
    `chain-${chainId}`,
    "deployed_addresses.json"
  );

  if (!fs.existsSync(deploymentInfoPath)) {
    console.error(
      "❌ Error: Deployment information not found. Make sure you have deployed the contracts first."
    );
    console.error(`Expected file at: ${deploymentInfoPath}`);
    process.exit(1);
  }

  const deploymentInfo = JSON.parse(
    fs.readFileSync(deploymentInfoPath, "utf-8")
  );
  
  const oracleAddressKey = Object.keys(deploymentInfo).find(key => key.endsWith("#Oracle"));
  if (!oracleAddressKey) {
    console.error("❌ Error: Oracle contract address not found in deployment info.");
    process.exit(1);
  }
  const oracleAddress = deploymentInfo[oracleAddressKey];
  console.log(`🔍 Found Oracle contract at address: ${oracleAddress}`);

  // --- 2. Get the contract instance ---
  const oracle: Oracle = await ethers.getContractAt("Oracle", oracleAddress);
  console.log("✅ Attached to Oracle contract instance.");

  // --- 3. Set up the event listener ---
  console.log("\n👂 Listening for 'PriceUpdated' events...\n");

  // THE FIX IS HERE: Use oracle.filters.PriceUpdated instead of the string "PriceUpdated"
  oracle.on(oracle.filters.PriceUpdated, (newPrice, timestamp, event) => {
    // Format the data for readability
    const formattedPrice = ethers.formatUnits(newPrice, 18);
    const date = new Date(Number(timestamp) * 1000); // Convert Unix timestamp to JS Date

    // Log the event details
    console.log("-----------------------------------------");
    console.log("🔔 New Price Update Received!");
    console.log(`   - Price:      $${formattedPrice}`);
    console.log(`   - Timestamp:  ${date.toLocaleString()}`);
    console.log("-----------------------------------------\n");
  });

  // Keep the script running indefinitely
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});