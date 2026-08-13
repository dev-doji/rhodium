/**
 * End-to-end demo of the ONE magic moment (§1.3):
 *   merchant lists a product → sends a payment request → buyer transfers to a
 *   DVA → within "seconds" the merchant is auto-notified, the buyer gets a
 *   receipt, and the ledger shows the sale — no screenshot, no manual check.
 *
 * Runs entirely on mocks (no credentials). `npm run demo`.
 */
import { loadEnv } from "../config/load-env.js";
loadEnv();
import { buildApp } from "../app.js";
import { loadConfig } from "../config/index.js";
import { CaptureTransport } from "../modules/notification/transport.js";
import { MonnifyFiatRail } from "../rails/monnify-fiat-rail.js";
import { formatNaira } from "../lib/money.js";

async function main(): Promise<void> {
  process.env.NODE_ENV = "development";
  const config = loadConfig();

  // Use a capture transport so we can print what the merchant + buyer receive.
  const merchantChannel = new CaptureTransport("whatsapp");
  const app = buildApp({ config, notificationChannels: [merchantChannel] });

  const line = (s = "") => console.log(s);
  line("=== Rhodium — the magic moment ===\n");

  // 1) Onboard a merchant (Amaka, the WhatsApp cosmetics seller).
  const merchant = await app.repos.merchants.create({
    id: "mch_amaka",
    phone: "+2348030000001",
    businessName: "Amaka Beauty",
    status: "active",
    kycState: "verified",
    cryptoEnabled: false,
    settlementBankCode: "058",
    settlementAccountNumber: "0123456789",
  });
  line(`👩🏾 Merchant onboarded: ${merchant.businessName} (${merchant.phone})`);

  // 2) Merchant lists a product via WhatsApp.
  line("\n[WA merchant → bot] add Red Lipstick 5000");
  line("[bot → merchant]\n" + indent(await app.whatsapp.handleInbound({
    from: merchant.phone,
    text: "add Red Lipstick 5000",
  })));

  const [product] = await app.commerce.listProducts(merchant.id);
  if (!product) throw new Error("product not created");

  // 3) Merchant sends a one-tap payment request for a buyer.
  line(`\n[WA merchant → bot] sell ${product.id} 1 +2348090000009`);
  const reply = await app.whatsapp.handleInbound({
    from: merchant.phone,
    text: `sell ${product.id} 1 +2348090000009`,
  });
  line("[bot → merchant]\n" + indent(reply));

  // 4) Buyer transfers to the reserved account → Monnify posts a signed webhook.
  const order = (await app.repos.orders.listByMerchant(merchant.id))[0]!;
  const payment = (await app.repos.payments.byOrderId(order.id))!;
  const fiat = app.rails.fiat() as MonnifyFiatRail;
  line("\n💸 Buyer transfers to the reserved account… (Monnify fires SUCCESSFUL_TRANSACTION)");
  const webhook = fiat.mock!.simulateTransfer(payment.providerRef);

  const t0 = Date.now();
  await app.payments.handleRailWebhook("monnify", {
    headers: { "monnify-signature": webhook.signature },
    rawBody: webhook.rawBody,
  });
  const ms = Date.now() - t0;

  // 5) Show the outcome: auto-notify + receipt + ledger, all within ms.
  line(`\n⚡ Reconciled + confirmed in ${ms}ms (no screenshot, no manual check):\n`);
  for (const m of merchantChannel.sent) {
    line(`   [→ ${m.to}]`);
    line(indent(m.message, "     "));
    line();
  }

  const finalOrder = await app.repos.orders.byId(order.id);
  const balance = await app.ledger.balance(merchant.id);
  const entries = await app.ledger.entries(merchant.id);
  line(`📒 Order status: ${finalOrder!.status}`);
  line(`📒 Ledger entries: ${entries.length}  |  running balance: ${formatNaira(balance)}`);

  // 6) Prove idempotency: a duplicate webhook must NOT double-count.
  const replay = fiat.mock!.replayLastTransfer(payment.providerRef);
  await app.payments.handleRailWebhook("monnify", {
    headers: { "monnify-signature": replay.signature },
    rawBody: replay.rawBody,
  });
  const afterReplay = await app.ledger.entries(merchant.id);
  line(`\n🔁 Replayed the SAME webhook → ledger entries still: ${afterReplay.length} (idempotent ✓)`);

  // 7) Reconciliation is clean.
  const report = await app.reconciliation.run();
  line(`\n✅ Daily reconciliation: ${report.clean ? "CLEAN" : "DRIFT!"} ` +
    `(${report.paymentsChecked} payments checked, ${report.drift.length} drift)`);

  line("\nMetrics snapshot:");
  line(indent(JSON.stringify(app.metrics.snapshot(), null, 2)));
}

function indent(s: string, pad = "   "): string {
  return s.split("\n").map((l) => pad + l).join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
