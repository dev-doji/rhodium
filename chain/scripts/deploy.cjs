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
const PK = process.env.QUAI_PRIVATE_KEY || process.env.CYPRUS1_PK;

async function main() {
  if (!PK) throw new Error("set QUAI_PRIVATE_KEY in .env (a faucet-funded Cyprus1 key)");

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

  // Quai requires an IPFS hash of the contract metadata on deploy. Compute the
  // CID of the Solidity metadata (from the build-info) — no pinning needed to deploy.
  const Hash = require("ipfs-only-hash");
  const biDir = path.join(__dirname, "..", "artifacts", "build-info");
  const biFile = path.join(biDir, fs.readdirSync(biDir).find((f) => f.endsWith(".json")));
  const bi = JSON.parse(fs.readFileSync(biFile, "utf8"));
  const metadata = bi.output.contracts["contracts/RhodiumPay.sol"]["RhodiumPay"].metadata;
  const ipfsHash = await Hash.of(Buffer.from(metadata));
  console.log("IPFS metadata hash:", ipfsHash, `(${ipfsHash.length} chars)`);

  const provider = new quais.JsonRpcProvider(RPC, undefined, { usePathing: true });
  const wallet = new quais.Wallet(PK, provider);
  console.log("Deployer:", wallet.address);

  // Log each step so we can see where a hang happens.
  const step = (m) => console.log(`  … ${m}`);

  step("fetching network");
  const net = await withTimeout(provider.getNetwork(), 20000, "getNetwork");
  console.log("  chainId:", net.chainId.toString());

  step("fetching fee data");
  const fee = await withTimeout(provider.getFeeData(), 20000, "getFeeData").catch((e) => {
    console.log("  (feeData failed, using manual gas):", e.message);
    return null;
  });

  const factory = new quais.ContractFactory(artifact.abi, artifact.bytecode, wallet, ipfsHash);
  step("building + broadcasting deploy tx (explicit gasLimit)");
  const overrides = { gasLimit: 3_000_000n };
  if (fee && fee.maxFeePerGas) {
    overrides.maxFeePerGas = fee.maxFeePerGas;
    overrides.maxPriorityFeePerGas = fee.maxPriorityFeePerGas ?? fee.maxFeePerGas;
  } else if (fee && fee.gasPrice) {
    overrides.gasPrice = fee.gasPrice;
  }
  const contract = await factory.deploy(overrides);

  const tx = contract.deploymentTransaction();
  console.log("  ✔ broadcast tx:", tx && tx.hash);
  step("waiting for it to be mined…");
  await withTimeout(contract.waitForDeployment(), 180000, "waitForDeployment");
  const address = await contract.getAddress();

  console.log("\n✅ RhodiumPay deployed:", address);
  console.log("→ set QUAI_CONTRACT_ADDRESS=%s in .env", address);
  console.log("→ verify: https://orchard.quaiscan.io/address/%s", address);
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
