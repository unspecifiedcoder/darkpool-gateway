import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox"; // Often includes common plugins
// Import other plugins as needed
import "hardhat-gas-reporter"; // [6, 17, 24]
import "solidity-coverage"; // [3]
import "@typechain/hardhat"; // [3, 10]
import "hardhat-deploy"; // [3, 10]
// ... any other plugins

// hardhat 18th
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY || "0xdf57089febbacf7ba0bc227dafbffa9fc08a93fdc68e1e42411a14efcf23656e";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.28", // Specify your primary Solidity version
        settings: {
          optimizer: {
            enabled: true,
            runs: 200, // Adjust 'runs' based on how often functions are expected to be called
          },
          // viaIR: true, 
        },
      }
    ],
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      accounts: [deployerPrivateKey, "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"],
    },
    hardhat: { // Default local network

      allowUnlimitedContractSize: true, // Useful for development and testing complex contracts
      gasPrice: "auto", // or a specific number in gwei e.g., 8000000000 (8 gwei)
      // forking: {
      //   url: "YOUR_ALCHEMY_OR_INFURA_MAINNET_RPC_URL",
      //   blockNumber: 19000000, // Optional: Fork from a specific block
      //   enabled: process.env.FORKING_ENABLED === "true", // Control forking via environment variable
      // },
      // accounts: [ // You can specify accounts for the hardhat network
      //   { privateKey: "YOUR_PRIVATE_KEY", balance: "10000000000000000000000" }
      // ]
    },
    sepolia: { // Example testnet configuration
      url: `https://sepolia.infura.io/v3/${process.env.INFURA_PROJECT_ID || ""}`,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      // gasPrice: 20000000000, // 20 Gwei (optional, let Hardhat estimate)
      // gas: 6000000, // Optional: gas limit for deployments
    },
  },
  gasReporter: { // Configuration for hardhat-gas-reporter [6, 17, 22, 24]
    enabled: true, // Control with env var [6, 24]
    currency: "USD", // [6, 17, 22]
    coinmarketcap: process.env.COINMARKETCAP_API_KEY || "", // For accurate USD costs [6, 17, 22]
    outputFile: process.env.CI ? "gas-report.txt" : undefined, // Save to file in CI, otherwise print to console
    noColors: !!process.env.CI, // Disable colors in CI for cleaner logs
    // excludeContracts: ["vendor/", "mocks/"], // Exclude contracts from the report
    // L1: "ethereum", // Specify L1 for L2 cost reporting (e.g., "ethereum", "polygon") [6]
  },
  typechain: { // Configuration for @typechain/hardhat [3, 10, 42]
    outDir: "typechain-types",
    alwaysGenerateOverloads: false,
    // dontOverrideCompile: false // Optional: Set to true if TypeChain shouldn't override the compile task
  },
  paths: { // Customize your project paths
    sources: "./contracts",
    tests: "./test",
    cache: "./cache_hardhat", // Default: ./cache
    artifacts: "./artifacts", // Default: ./artifacts
    // ignition: "./ignition", // Default for Hardhat Ignition modules [20]
  },
  mocha: { // Mocha test runner options
    timeout: 40000, // Increase timeout for long-running tests (e.g., forking tests)
  },
  // etherscan: {
  //   apiKey: {
  //     mainnet: process.env.ETHERSCAN_API_KEY || "",
  //     sepolia: process.env.ETHERSCAN_API_KEY || "",
  //   },
  // },
};

export default config;