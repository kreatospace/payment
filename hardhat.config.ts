import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-network-helpers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import * as dotenv from "dotenv";

dotenv.config();

// ─── ENV ───────────────────────────────────────────

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";

if (!DEPLOYER_PRIVATE_KEY) {
  console.warn("⚠️ DEPLOYER_PRIVATE_KEY is not set");
}

// ─── CONFIG ────────────────────────────────────────

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",  // ← was 0.8.20
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",  // ← add this
    },
  },

  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },

  networks: {
    // ─── Ethereum ───────────────────────────────────
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: 11155111,
    },

    mainnet: {
      url: process.env.ETH_RPC_URL || "",
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: 1,
    },

    // ─── Base ───────────────────────────────────────
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || "",
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: 84532,
    },

    base: {
      url: process.env.BASE_RPC_URL || "",
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: 8453,
    },

    // ─── Local ──────────────────────────────────────
    hardhat: {
      chainId: 31337,
    },
  },

  // ─── Contract verification ───────────────────────
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",  // single key, works for all chains

    customChains: [
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
    ],
  },

  // ─── Gas reporter ────────────────────────────────
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    coinmarketcap: process.env.COINMARKETCAP_API_KEY, // optional but better accuracy
  },
};

export default config;