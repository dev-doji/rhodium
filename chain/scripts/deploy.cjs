/**
 * Deploy RhodiumPay to Quai Orchard testnet using the quais SDK.
 *
 * Prereqs:
 *   1) npm --prefix chain install && npm --prefix chain run compile
 *   2) Fund a Cyprus1 address from the faucet: https://orchard.faucet.quai.network
 *   3) Set CYPRUS1_PK in .env (the funded private key)
 *   4) npm --prefix chain run deploy
 *
 * Prints the deployed address — put it in .env as QUAI_CONTRACT_ADDRESS and set
 * QUAI_ADAPTER_MODE=live to switch Rhodium's crypto rail onto the real chain.
 */
require("dotenv").config({ path: "../.env" });
const fs = require("node:fs");
const path = require("node:path");
const quais = require("quais");

const RPC = process.env.QUAI_RPC_URL || "https://orchard.rpc.quai.network/cyprus1";
const PK = process.env.CYPRUS1_PK;

async function main() {
  if (!PK) throw new Error("set CYPRUS1_PK in .env (a faucet-funded Cyprus1 key)");

  const artifactPath = path.join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    "RhodiumPay.sol",
    "RhodiumPay.json",
  );
  if (!fs.existsSync(artifactPath)) {
    throw new Error("compile first: npm --prefix chain run compile");
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  const provider = new quais.JsonRpcProvider(RPC, undefined, { usePathing: true });
  const wallet = new quais.Wallet(PK, provider);
  console.log("Deployer:", wallet.address);

  const factory = new quais.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  console.log("Deploying RhodiumPay to Orchard…");
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("\n✅ RhodiumPay deployed:", address);
  console.log("→ set QUAI_CONTRACT_ADDRESS=%s in .env", address);
  console.log("→ verify: https://orchard.quaiscan.io/address/%s", address);
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
