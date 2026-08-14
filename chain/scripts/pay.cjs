/**
 * Pay a Rhodium crypto order on-chain, end to end, from the terminal.
 *
 *   node scripts/pay.cjs <orderId> [--app https://rhodium-8ocg.onrender.com]
 *
 * This is the headless twin of public/checkout.html: it pulls the SAME payment
 * instruction the checkout page uses (so the amount and the orderId hash can
 * never drift from what the backend will verify), sends `payNative` through the
 * RhodiumPay forwarder, then POSTs /api/crypto/confirm so the backend reads the
 * receipt, decodes the `Paid` event, and moves the order to `paid`.
 *
 * Use it to demo the crypto rail without a browser wallet.
 *
 * DO NOT hand-roll and offline-sign this transaction. A hand-built tx is what
 * produced the long-standing "mines but reverts with status 0x0, all gas
 * consumed, while quai_call succeeds" symptom. Let the SDK populate the tx:
 * `populateQuaiTransaction` sets the Quai-correct gas price for the sender's
 * own zone and estimates gas. The contract was never at fault.
 *
 * Env: QUAI_PRIVATE_KEY (the buyer's funded Cyprus1 key), optional QUAI_RPC_URL.
 */
require("dotenv").config({ path: "../.env" });
const quais = require("quais");

const RPC = process.env.QUAI_RPC_URL || "https://orchard.rpc.quai.network/cyprus1";
// The SDK appends its own shard paths (see deploy.cjs) — hand it the bare host.
const SHARD_SUFFIX = /\/(prime|cyprus[1-3]|paxos[1-3]|hydra[1-3])\/*$/i;
const baseRpc = RPC.replace(SHARD_SUFFIX, "");
const PK = process.env.QUAI_PRIVATE_KEY || process.env.CYPRUS1_PK;

const args = process.argv.slice(2);
const orderId = args.find((a) => !a.startsWith("--"));
const appFlag = args.indexOf("--app");
const APP =
  (appFlag !== -1 && args[appFlag + 1]) ||
  process.env.PUBLIC_BASE_URL ||
  "https://rhodium-8ocg.onrender.com";

const ABI = [
  "function payNative(bytes32 orderId, address payable merchant) payable",
  "function payToken(bytes32 orderId, address merchant, address token, uint256 amount)",
];

async function main() {
  if (!orderId) throw new Error("usage: node scripts/pay.cjs <orderId> [--app <url>]");
  if (!PK) throw new Error("set QUAI_PRIVATE_KEY in .env (the buyer's funded Cyprus1 key)");

  const step = (m) => console.log(`  … ${m}`);

  step(`fetching payment instruction from ${APP}`);
  const res = await fetchRetry(`${APP}/api/checkout/${orderId}`);
  if (!res.ok) throw new Error(`checkout lookup failed: HTTP ${res.status}`);
  const { order, instruction, quaiMode } = await res.json();
  if (!instruction) throw new Error(`order ${orderId} has no crypto instruction (rail=${order?.rail})`);
  if (quaiMode !== "live") throw new Error(`app is in quaiMode=${quaiMode}; nothing to pay on-chain`);
  if (order.status === "paid") {
    console.log(`order ${orderId} is already paid — nothing to do`);
    return;
  }
  if (instruction.method !== "payNative") {
    throw new Error(`this script only handles payNative (order asks for ${instruction.method})`);
  }
  console.log(`  order ${order.id}: ${order.amountFormatted} → ${quais.formatQuai(instruction.cryptoAmount)} QUAI`);
  console.log(`  merchant: ${instruction.merchantAddress}`);

  const net = quais.Network.from(Number(instruction.chainId || 15000));
  const provider = new quais.JsonRpcProvider(baseRpc, net, { staticNetwork: net, usePathing: true });
  const wallet = new quais.Wallet(PK, provider);
  console.log("  buyer:", wallet.address);

  const balance = await provider.getBalance(wallet.address);
  if (balance <= BigInt(instruction.cryptoAmount)) {
    throw new Error(
      `buyer has ${quais.formatQuai(balance)} QUAI, needs more than ` +
        `${quais.formatQuai(instruction.cryptoAmount)} (plus gas) — top up at https://orchard.faucet.quai.network`,
    );
  }

  // Reuse the backend's own orderId hash rather than recomputing it; if the two
  // ever disagreed, the Paid event would be unmatchable and the order would sit
  // unpaid with the buyer's money already forwarded.
  const orderIdHash = instruction.orderIdBytes32 || quais.id(orderId);
  const contract = new quais.Contract(instruction.contractAddress, ABI, wallet);

  step("sending payNative");
  const tx = await contract.payNative(orderIdHash, instruction.merchantAddress, {
    value: BigInt(instruction.cryptoAmount),
  });
  console.log("  broadcast:", tx.hash);

  step("waiting for it to be mined…");
  const receipt = await tx.wait();
  if (receipt.status !== 1) {
    throw new Error(`tx reverted on-chain (status ${receipt.status}, gasUsed ${receipt.gasUsed})`);
  }
  console.log(`  ✔ mined: status 1, gasUsed ${receipt.gasUsed}, ${receipt.logs.length} log(s)`);

  // The buyer's money is already forwarded by this point, so the confirm call
  // is the one that must not be lost to a cold start — retry it hard.
  step("confirming with the backend");
  const confirm = await fetchRetry(`${APP}/api/crypto/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId, txHash: tx.hash }),
  });
  const confirmBody = await confirm.text();
  if (!confirm.ok) throw new Error(`confirm failed: HTTP ${confirm.status} ${confirmBody}`);

  const after = await (await fetchRetry(`${APP}/api/checkout/${orderId}`)).json();
  console.log(`\n✅ order ${orderId} is now: ${after.order.status}`);
  console.log("→ tx: https://orchard.quaiscan.io/tx/%s", tx.hash);
}

/**
 * Render's free tier spins the service down after idling; the first request to a
 * cold instance can fail outright ("fetch failed") rather than just being slow.
 * Retry with backoff so a sleeping demo box doesn't look like a broken script.
 */
async function fetchRetry(url, init, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      lastErr = e;
      const wait = 3000 * (i + 1);
      console.log(`  (request failed: ${e.message} — retrying in ${wait / 1000}s)`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("✗", e.message);
    process.exit(1);
  });
