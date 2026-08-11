/**
 * Hardhat config for the RhodiumPay contract on Quai Orchard testnet.
 * We use Hardhat only to COMPILE (solc 0.8.20, as the buildathon requires);
 * deployment uses the quais SDK directly in scripts/deploy.cjs, which is the
 * supported path on Quai. Contract source lives at repo-root /contracts.
 */
require("dotenv").config({ path: "../.env" });

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  paths: {
    sources: "./contracts",
    artifacts: "./artifacts",
    cache: "./cache",
  },
};
