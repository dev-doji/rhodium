/**
 * Prove the EVM rail against the REAL Arc chain, not the mock.
 *
 *   npm run smoke:arc -- <orderId> <txHash> [merchantAddress]
 *
 * The mock chain proves the rail's logic and proves nothing about Arc. This
 * runs the actual production rail — same class the server wires up — against a
 * real transaction, so a wrong token address, a wrong decimals setting or a
 * chain that silently is not Arc shows up here rather than after a buyer has
 * paid.
 *
 * Produce a transaction to check with:
 *   node chain/scripts/pay-arc.cjs <orderId> <merchantAddress> <usdcAmount>
 *
 * Defaults to Arc Testnet; ARC_CHAIN_ID=5042 points it at mainnet.
 */
import { EvmStableRail } from "../rails/evm-stable-rail.js";

const NETWORKS: Record<number, { name: string; rpc: string; explorer: string }> = {
  5042002: {
    name: "Arc Testnet",
    rpc: "https://rpc.testnet.arc.io",
    explorer: "https://explorer.testnet.arc.io",
  },
  5042: { name: "Arc", rpc: "https://rpc.mainnet.arc.io", explorer: "https://explorer.arc.io" },
};

async function main(): Promise<void> {
  const [orderId, txHash, merchant] = process.argv.slice(2);
  if (!orderId || !txHash) {
    throw new Error("usage: npm run smoke:arc -- <orderId> <txHash> [merchantAddress]");
  }

  const chainId = Number(process.env.ARC_CHAIN_ID || 5042002);
  const net = NETWORKS[chainId];
  if (!net) throw new Error(`unknown Arc chain id ${chainId}`);

  const rail = new EvmStableRail({
    mode: "live",
    chainId,
    chainName: net.name,
    rpcUrl: process.env.ARC_RPC_URL || net.rpc,
    explorerUrl: net.explorer,
    contractAddress: "0x80cD8120170c799501E9a7eA0da4203AD52C1d7d",
    // Arc's USDC: native gas token, and an IERC20 at six decimals. Six is the
    // interface payToken() moves through; eighteen is the native one.
    tokenAddress: "0x3600000000000000000000000000000000000000",
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    ngnPerUsd: () => Number(process.env.FX_NGN_PER_USD || 1600),
    publicBaseUrl: process.env.PUBLIC_BASE_URL || "http://localhost:3000",
  });

  console.log(`Network: ${net.name} (${chainId})`);
  console.log(`Order  : ${orderId}`);
  console.log(`Tx     : ${txHash}\n`);

  const webhook = await rail.handleWebhook({
    headers: {},
    rawBody: JSON.stringify({ orderId, txHash }),
  });
  console.log("handleWebhook — reads the receipt and decodes Paid:");
  console.log(`  status    : ${webhook.status}`);
  console.log(`  amount    : ${webhook.amount} kobo (₦${((webhook.amount ?? 0) / 100).toFixed(2)})`);
  console.log(`  recipient : ${webhook.recipient}`);
  console.log(`  idemKey   : ${webhook.idempotencyKey}`);

  const poll = await rail.verifyPayment(orderId);
  console.log("\nverifyPayment — the poll fallback, scanning Paid logs:");
  console.log(`  status    : ${poll.status}`);
  console.log(`  amount    : ${poll.amount} kobo`);
  console.log(`  recipient : ${poll.recipient}`);

  const unpaid = await rail.verifyPayment(`ord_never_paid_${Date.now()}`);
  console.log(`\nan order nobody paid: ${unpaid.status}`);

  const checks: [string, boolean][] = [
    ["webhook confirms", webhook.status === "confirmed"],
    ["poll confirms", poll.status === "confirmed"],
    ["amounts agree", webhook.amount === poll.amount],
    ["unpaid order stays pending", unpaid.status === "pending"],
  ];
  if (merchant) {
    checks.push([
      "recipient is the merchant",
      webhook.recipient?.toLowerCase() === merchant.toLowerCase(),
    ]);
  }

  console.log("");
  for (const [label, ok] of checks) console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (checks.some(([, ok]) => !ok)) process.exit(1);
  console.log(`\nArc verified end to end against ${net.name}.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
