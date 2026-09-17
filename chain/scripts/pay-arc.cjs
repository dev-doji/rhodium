/**
 * Pay a Rhodium crypto order on Arc, on-chain, from the terminal.
 *
 *   node scripts/pay-arc.cjs <orderId> <merchantAddress> <usdcAmount>
 *
 * The headless twin of the checkout page's wallet flow, used to prove the Arc
 * rail against the real chain rather than the mock: it does the ERC-20 approve
 * and then calls RhodiumPay.payToken(), which moves USDC buyer -> merchant in
 * one transaction and emits Paid(orderId, ...). The backend confirms an order
 * by finding that log, so producing a real one is the only honest way to show
 * the rail works here.
 *
 * On Arc the token being moved IS the gas token — one balance, reached through
 * two interfaces. payToken() goes through the ERC-20 one, which is SIX decimals,
 * so `usdcAmount` is an ordinary decimal figure like 0.01.
 *
 * Env: ARC_PRIVATE_KEY (the buyer's funded key), optional ARC_CHAIN_ID/ARC_RPC_URL.
 * Defaults to Arc Testnet. Spends real USDC on mainnet.
 */
require("dotenv").config({ path: "../.env" });
const ethers = require("ethers");

const NETWORKS = {
  5042002: { name: "Arc Testnet", rpc: "https://rpc.testnet.arc.io", explorer: "https://explorer.testnet.arc.io" },
  5042: { name: "Arc", rpc: "https://rpc.mainnet.arc.io", explorer: "https://explorer.arc.io" },
};
const USDC = "0x3600000000000000000000000000000000000000";
const RHODIUM_PAY = "0x80cD8120170c799501E9a7eA0da4203AD52C1d7d";
const MIN_FEE_WEI = 20_000_000_000n; // Arc's mempool floor; under it is rejected.

const PAY_ABI = [
  "function payToken(bytes32 orderId, address merchant, address token, uint256 amount)",
  "event Paid(bytes32 indexed orderId, address indexed merchant, address token, uint256 amount, address payer)",
];
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

async function main() {
  const [orderId, merchant, amountStr] = process.argv.slice(2);
  if (!orderId || !merchant || !amountStr) {
    throw new Error("usage: node scripts/pay-arc.cjs <orderId> <merchantAddress> <usdcAmount>");
  }
  const PK = process.env.ARC_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!PK) throw new Error("set ARC_PRIVATE_KEY to the buyer's private key");

  const chainId = Number(process.env.ARC_CHAIN_ID || 5042002);
  const meta = NETWORKS[chainId];
  if (!meta) throw new Error(`unknown Arc chain id ${chainId}`);
  const rpc = process.env.ARC_RPC_URL || meta.rpc;

  const net = ethers.Network.from(chainId);
  const provider = new ethers.JsonRpcProvider(rpc, net, { staticNetwork: net });
  const wallet = new ethers.Wallet(PK, provider);

  const usdc = new ethers.Contract(USDC, ERC20_ABI, wallet);
  const decimals = Number(await usdc.decimals());
  const amount = ethers.parseUnits(amountStr, decimals);
  // keccak of the ASCII order id — the same derivation the rail uses to build
  // the call and to match the resulting log. They must not drift.
  const orderIdBytes32 = ethers.keccak256(ethers.toUtf8Bytes(orderId));

  console.log(`Network  : ${meta.name} (${chainId})`);
  console.log(`Buyer    : ${wallet.address}`);
  console.log(`Merchant : ${merchant}`);
  console.log(`Amount   : ${amountStr} USDC (${amount} base units, ${decimals} dp)`);
  console.log(`orderId  : ${orderId}`);
  console.log(`  bytes32: ${orderIdBytes32}`);

  const balance = await usdc.balanceOf(wallet.address);
  console.log(`Balance  : ${ethers.formatUnits(balance, decimals)} USDC`);
  if (balance < amount) throw new Error("buyer does not hold enough USDC");

  const fee = await provider.getFeeData();
  const suggested = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  const maxFeePerGas = suggested > MIN_FEE_WEI ? suggested : MIN_FEE_WEI;

  const allowance = await usdc.allowance(wallet.address, RHODIUM_PAY);
  if (allowance < amount) {
    console.log("  … approving");
    const a = await usdc.approve(RHODIUM_PAY, amount, { maxFeePerGas });
    console.log(`  approve tx: ${a.hash}`);
    await a.wait();
  }

  console.log("  … paying");
  const pay = new ethers.Contract(RHODIUM_PAY, PAY_ABI, wallet);
  const tx = await pay.payToken(orderIdBytes32, merchant, USDC, amount, { maxFeePerGas });
  console.log(`  payToken tx: ${tx.hash}`);
  const receipt = await tx.wait();

  console.log("");
  console.log(`Status   : ${receipt.status === 1 ? "success" : "FAILED"}`);
  console.log(`Explorer : ${meta.explorer}/tx/${tx.hash}`);

  const paid = receipt.logs
    .map((l) => {
      try {
        return pay.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p && p.name === "Paid");
  if (!paid) throw new Error("no Paid log in the receipt — the rail would not confirm this");

  console.log("");
  console.log("Paid event — this is what the backend matches on:");
  console.log(`  orderId : ${paid.args.orderId}`);
  console.log(`  merchant: ${paid.args.merchant}`);
  console.log(`  token   : ${paid.args.token}`);
  console.log(`  amount  : ${paid.args.amount} (${ethers.formatUnits(paid.args.amount, decimals)} USDC)`);
  console.log(`  payer   : ${paid.args.payer}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
