/**
 * Deploy RhodiumPay to Arbitrum.
 *
 * The contract itself needed no changes: RhodiumPay.sol is plain Solidity
 * 0.8.20 with no chain-specific imports, so the same source that ran on Quai
 * compiles and deploys here unmodified. Only the deployment path differs.
 *
 * Deliberately NOT the Quai script with a flag. That one carries Cyprus1 shard
 * pathing, zone checks and address grinding, none of which exist on Arbitrum —
 * threading a conditional through all of it would leave one script where every
 * line has to be read twice to know which chain it is talking about.
 *
 * Uses ethers rather than quais. quais is an ethers fork, but it applies Quai
 * zone rules to every address even with shard pathing disabled — an ordinary
 * Arbitrum key fails with "Invalid zone" before a single call goes out. ethers
 * is a devDependency of this workspace only; the server does not gain it.
 *
 *   ARBITRUM_PRIVATE_KEY=0x... node scripts/deploy-arbitrum.cjs
 *
 * Pass --estimate to price the deployment without sending anything. Worth
 * doing on mainnet before committing real ETH.
 *
 * Defaults to Arbitrum Sepolia. Pass ARBITRUM_CHAIN_ID=42161 with a mainnet
 * RPC for Arbitrum One — and read the balance line before confirming, because
 * that one spends real money.
 */
require("dotenv").config({ path: "../.env" });
const fs = require("node:fs");
const path = require("node:path");
const ethers = require("ethers");

const NETWORKS = {
  421614: { name: "Arbitrum Sepolia", explorer: "https://sepolia.arbiscan.io" },
  42161: { name: "Arbitrum One", explorer: "https://arbiscan.io" },
};

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function main() {
  // Accept the obvious spellings. A deploy that fails because the key was
  // called something reasonable-but-different wastes a round trip for no gain.
  const PK =
    process.env.ARBITRUM_PRIVATE_KEY ||
    process.env.DEPLOYER_PRIVATE_KEY ||
    process.env.EVM_DEPLOYER_PRIVATE_KEY;
  if (!PK) {
    throw new Error(
      "set ARBITRUM_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) to the deployer's private key",
    );
  }

  const chainId = Number(process.env.ARBITRUM_CHAIN_ID || process.env.EVM_CHAIN_ID || 421614);
  const meta = NETWORKS[chainId];
  if (!meta) throw new Error(`unknown Arbitrum chain id ${chainId} (expected 421614 or 42161)`);

  const rpc =
    process.env.ARBITRUM_RPC_URL ||
    process.env.EVM_RPC_URL ||
    (chainId === 42161
      ? "https://arb1.arbitrum.io/rpc"
      : "https://sepolia-rollup.arbitrum.io/rpc");

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

  // Static network: skips a chain-id round trip, and makes a mismatch between
  // the RPC and the id we were told to use fail loudly instead of deploying to
  // whichever chain the URL happened to point at.
  const net = ethers.Network.from(chainId);
  const provider = new ethers.JsonRpcProvider(rpc, net, { staticNetwork: net });
  const wallet = new ethers.Wallet(PK, provider);

  console.log(`Network : ${meta.name} (${chainId})`);
  console.log(`RPC     : ${rpc}`);
  console.log(`Deployer: ${wallet.address}`);

  const onChainId = Number((await withTimeout(provider.getNetwork(), 25000, "getNetwork")).chainId);
  if (onChainId !== chainId) {
    throw new Error(`RPC reports chain ${onChainId}, expected ${chainId} — wrong endpoint`);
  }

  const balance = await withTimeout(provider.getBalance(wallet.address), 25000, "getBalance");
  console.log(`Balance : ${ethers.formatEther(balance)} ETH`);
  // Deliberately NOT fatal under --estimate: pricing the deployment is most
  // useful on a key that has not been funded yet, which is exactly when you
  // want to know how much to send it.
  if (balance === 0n && !process.argv.includes("--estimate")) {
    throw new Error(
      chainId === 421614
        ? "deployer has no ETH — fund it at https://faucet.quicknode.com/arbitrum/sepolia"
        : "deployer has no ETH on Arbitrum One",
    );
  }

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  // Price it from the chain rather than from a remembered figure: Arbitrum's
  // fee is mostly the L1 data cost, which moves with Ethereum's gas market and
  // can differ by an order of magnitude within a day.
  const deployTx = await factory.getDeployTransaction();
  const fee = await withTimeout(provider.getFeeData(), 25000, "getFeeData");
  let gas;
  try {
    gas = await withTimeout(
      provider.estimateGas({ ...deployTx, from: wallet.address }),
      25000,
      "estimateGas",
    );
  } catch (err) {
    // An unfunded address makes estimateGas revert before it can measure
    // anything. Estimate from the deployer-agnostic path instead so the
    // number is still useful.
    gas = await withTimeout(provider.estimateGas(deployTx), 25000, "estimateGas");
  }
  const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  const cost = gas * gasPrice;
  console.log(`Gas     : ${gas} units @ ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
  console.log(`Est cost: ${ethers.formatEther(cost)} ETH`);

  if (process.argv.includes("--estimate")) {
    console.log("");
    console.log("--estimate given: nothing was sent.");
    if (balance < cost) {
      console.log(`Short by ${ethers.formatEther(cost - balance)} ETH.`);
    }
    return;
  }
  if (balance < cost) {
    throw new Error(
      `deployer has ${ethers.formatEther(balance)} ETH but needs about ` +
        `${ethers.formatEther(cost)} ETH — fund it and retry`,
    );
  }

  console.log("  … deploying");
  const contract = await factory.deploy();
  const tx = contract.deploymentTransaction();
  console.log(`  tx: ${tx.hash}`);
  await withTimeout(contract.waitForDeployment(), 180000, "waitForDeployment");

  const address = await contract.getAddress();
  console.log("");
  console.log(`RhodiumPay deployed: ${address}`);
  console.log(`Explorer           : ${meta.explorer}/address/${address}`);
  console.log("");
  console.log("Set these on Render:");
  console.log(`  EVM_CONTRACT_ADDRESS=${address}`);
  console.log(`  EVM_CHAIN_ID=${chainId}`);
  console.log(`  EVM_CHAIN_NAME=${meta.name}`);
  console.log(`  EVM_RPC_URL=${rpc}`);
  console.log("  FEATURE_EVM_STABLE_ENABLED=true");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
