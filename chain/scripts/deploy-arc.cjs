/**
 * Deploy RhodiumPay to Arc (Circle's stablecoin L1).
 *
 * The contract needs no changes: RhodiumPay.sol is plain Solidity 0.8.20 with
 * no chain-specific imports, so the same source already running on Quai and
 * Arbitrum deploys here unmodified. Only the network details differ.
 *
 *   ARC_PRIVATE_KEY=0x... node scripts/deploy-arc.cjs
 *
 * Pass --estimate to price the deployment without sending anything.
 *
 * Defaults to Arc Testnet. Mainnet is an explicit opt-in — ARC_CHAIN_ID=5042 —
 * because that one spends real money.
 *
 * TWO THINGS ARE NOT LIKE OTHER EVM CHAINS, and both are easy to get wrong:
 *
 *   1. Gas is paid in USDC, not ETH. The native balance IS USDC, carried at
 *      eighteen decimals, so ethers' formatEther happens to render it
 *      correctly — the number is right even though the unit name is not. Every
 *      figure this script prints is USDC.
 *
 *   2. The mempool enforces a 20 gwei maxFeePerGas floor. A transaction priced
 *      under it is rejected rather than queued, so the fee is floored below.
 *
 * Note the ERC-20 interface on the same USDC is SIX decimals, which is what the
 * payments rail quotes and what payToken() moves. Eighteen decimals is the
 * native/gas interface only. They are one asset and one balance.
 */
require("dotenv").config({ path: "../.env" });
const fs = require("node:fs");
const path = require("node:path");
const ethers = require("ethers");

const NETWORKS = {
  5042002: {
    name: "Arc Testnet",
    explorer: "https://explorer.testnet.arc.io",
    rpc: "https://rpc.testnet.arc.io",
    usdc: "0x3600000000000000000000000000000000000000",
    faucet: "https://faucet.circle.com",
  },
  5042: {
    name: "Arc",
    explorer: "https://explorer.arc.io",
    rpc: "https://rpc.mainnet.arc.io",
    usdc: "0x3600000000000000000000000000000000000000",
  },
};

/** The floor Arc's mempool enforces; pricing under it is rejected outright. */
const MIN_FEE_WEI = 20_000_000_000n; // 20 gwei

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function main() {
  const PK =
    process.env.ARC_PRIVATE_KEY ||
    process.env.DEPLOYER_PRIVATE_KEY ||
    process.env.EVM_DEPLOYER_PRIVATE_KEY;
  if (!PK) {
    throw new Error(
      "set ARC_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) to the deployer's private key",
    );
  }

  const chainId = Number(process.env.ARC_CHAIN_ID || 5042002);
  const meta = NETWORKS[chainId];
  if (!meta) throw new Error(`unknown Arc chain id ${chainId} (expected 5042002 or 5042)`);

  const rpc = process.env.ARC_RPC_URL || meta.rpc;

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
  console.log(`Balance : ${ethers.formatEther(balance)} USDC`);
  if (balance === 0n && !process.argv.includes("--estimate")) {
    throw new Error(
      meta.faucet
        ? `deployer has no USDC for gas — fund it at ${meta.faucet}`
        : "deployer has no USDC for gas on Arc mainnet",
    );
  }

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const deployTx = await factory.getDeployTransaction();
  const fee = await withTimeout(provider.getFeeData(), 25000, "getFeeData");

  let gas;
  try {
    gas = await withTimeout(
      provider.estimateGas({ ...deployTx, from: wallet.address }),
      25000,
      "estimateGas",
    );
  } catch {
    // An unfunded address makes estimateGas revert before it can measure
    // anything. Estimate from the deployer-agnostic path instead.
    gas = await withTimeout(provider.estimateGas(deployTx), 25000, "estimateGas");
  }

  const suggested = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  const maxFeePerGas = suggested > MIN_FEE_WEI ? suggested : MIN_FEE_WEI;
  const cost = gas * maxFeePerGas;
  console.log(`Gas     : ${gas} units @ ${ethers.formatUnits(maxFeePerGas, "gwei")} gwei`);
  console.log(`Est cost: ${ethers.formatEther(cost)} USDC`);

  if (process.argv.includes("--estimate")) {
    console.log("");
    console.log("--estimate given: nothing was sent.");
    if (balance < cost) console.log(`Short by ${ethers.formatEther(cost - balance)} USDC.`);
    return;
  }
  if (balance < cost) {
    throw new Error(
      `deployer has ${ethers.formatEther(balance)} USDC but needs about ` +
        `${ethers.formatEther(cost)} USDC — fund it and retry`,
    );
  }

  console.log("  … deploying");
  const contract = await factory.deploy({ maxFeePerGas });
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
  console.log(`  EVM_TOKEN_ADDRESS=${meta.usdc}`);
  console.log("  EVM_TOKEN_DECIMALS=6   # the ERC-20 interface, NOT the 18-decimal native one");
  console.log("  FEATURE_EVM_STABLE_ENABLED=true");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
