/**
 * Deploy RhodiumPay to Quai Orchard testnet using the quais SDK.
 *
 * Prereqs:
 *   1) npm --prefix chain install && npm --prefix chain run compile
 *   2) Fund a Cyprus1 address from the faucet: https://orchard.faucet.quai.network
 *   3) Set QUAI_PRIVATE_KEY (or CYPRUS1_PK) in .env — the funded private key
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

// The quais provider does its OWN shard pathing: `usePathing` DEFAULTS TO TRUE,
// so it takes the URL it is given and appends `/prime` to discover which shards
// the node runs, then appends `/cyprus1` etc. for the per-shard connections.
// Hand it a URL that already ends in a shard and it builds
// `…/cyprus1/prime` → 404 → the discovery handshake never settles → `initPromise`
// never resolves → EVERY call hangs until the timeout. That was the deploy hang;
// omitting the option does not disable it, because the default is `true`.
//
// QUAI_RPC_URL has to keep the `/cyprus1` suffix for the app's rail
// (src/rails/quai-rail.ts POSTs to it directly), so normalize here instead of
// changing the env var: strip any trailing shard segment for the SDK.
const SHARD_SUFFIX = /\/(prime|cyprus[1-3]|paxos[1-3]|hydra[1-3])\/*$/i;
const baseRpc = RPC.replace(SHARD_SUFFIX, "");

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

  // Static network skips the chain-id auto-detect round trip. usePathing is
  // spelled out rather than left to the default so the intent survives edits.
  const CHAIN_ID = Number(process.env.QUAI_CHAIN_ID || 15000);
  const net = quais.Network.from(CHAIN_ID);
  const provider = new quais.JsonRpcProvider(baseRpc, net, {
    staticNetwork: net,
    usePathing: true,
  });
  const wallet = new quais.Wallet(PK, provider);
  console.log("RPC:", baseRpc, "(shard paths added by the SDK)");
  console.log("Deployer:", wallet.address);

  const step = (m) => console.log(`  … ${m}`);

  // Contract addresses are ground until they land in the deployer's own zone,
  // so a key from another shard would spin for 10k rounds and then deploy to a
  // zone this provider cannot reach. Fail loudly instead.
  const zone = quais.getZoneForAddress(wallet.address);
  if (zone !== quais.Zone.Cyprus1) {
    throw new Error(
      `deployer ${wallet.address} is in zone ${zone ?? "unknown"}, not Cyprus1 — ` +
        "fund a Cyprus1 key (address starts 0x00) at https://orchard.faucet.quai.network",
    );
  }

  // Every read is pinned to Cyprus1: with pathing on, a call with no shard goes
  // to the PRIME connection (the only entry in `connect`), which is the wrong
  // chain to read a Cyprus1 balance or nonce from.
  step("sanity: block number");
  const bn = await withTimeout(
    provider.getBlockNumber(quais.Shard.Cyprus1),
    25000,
    "getBlockNumber",
  );
  console.log("  block:", bn);

  step("checking deployer balance");
  const balance = await withTimeout(provider.getBalance(wallet.address), 25000, "getBalance");
  console.log("  balance:", quais.formatQuai(balance), "QUAI");
  if (balance === 0n) {
    throw new Error("deployer has 0 QUAI — fund it at https://orchard.faucet.quai.network");
  }

  const factory = new quais.ContractFactory(artifact.abi, artifact.bytecode, wallet, ipfsHash);
  step("building + broadcasting deploy tx");
  // The signer's populateQuaiTransaction fills gas price from getFeeData() for
  // the deployer's own zone and estimates gas, so no manual fee wiring here.
  // QUAI_GAS_LIMIT is an escape hatch if estimation ever misbehaves.
  const overrides = {};
  if (process.env.QUAI_GAS_LIMIT) overrides.gasLimit = BigInt(process.env.QUAI_GAS_LIMIT);
  const contract = await withTimeout(factory.deploy(overrides), 60000, "factory.deploy");

  const tx = contract.deploymentTransaction();
  console.log("  ✔ broadcast tx:", tx && tx.hash);
  step("waiting for it to be mined…");
  await withTimeout(contract.waitForDeployment(), 180000, "waitForDeployment");
  const address = await contract.getAddress();

  console.log("\n✅ RhodiumPay deployed:", address);
  console.log("→ set QUAI_CONTRACT_ADDRESS=%s in .env", address);
  console.log("→ verify: https://orchard.quaiscan.io/address/%s", address);
}

// The timer has to be cleared on the happy path too — an un-cleared 180s timer
// keeps the event loop alive and the CLI would appear to hang *after* printing
// a successful deploy.
function withTimeout(promise, ms, label) {
  let timer;
  const bomb = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, bomb]).finally(() => clearTimeout(timer));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("✗", e.message);
    process.exit(1);
  });
