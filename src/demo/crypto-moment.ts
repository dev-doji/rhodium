/**
 * End-to-end demo of the crypto magic moment (hackathon):
 *   merchant sells over WhatsApp with `crypto` → buyer gets a BlipPay link →
 *   pays in USDT on Quai → RhodiumPay forwards to the merchant (no custody) →
 *   merchant auto-notified + buyer receipted + the sale lands in the NAIRA
 *   ledger and the live traction feed. Runs on mocks (no chain). `npm run demo:crypto`.
 */
import { loadEnv } from "../config/load-env.js";
loadEnv();
import { buildApp } from "../app.js";
import { loadConfig } from "../config/index.js";
import { CaptureTransport } from "../modules/notification/transport.js";
import { QuaiRail } from "../rails/quai-rail.js";
import { koboToUsdtUnits, humanUsdt } from "../lib/fx.js";
import { formatNaira } from "../lib/money.js";

async function main(): Promise<void> {
  process.env.NODE_ENV = "development";
  const channel = new CaptureTransport("whatsapp");
  const app = buildApp({ config: loadConfig(), notificationChannels: [channel] });
  const line = (s = "") => console.log(s);

  line("=== Rhodium × Quai × BlipPay — the crypto magic moment ===\n");

  const merchant = await app.repos.merchants.create({
    id: "mch_amaka",
    phone: "+2348030000001",
    businessName: "Amaka Beauty",
    status: "active",
    kycState: "verified",
    cryptoEnabled: true,
    quaiAddress: "0xA11CEmerchantWalletOnQuai",
  });
  line(`👩🏾 Merchant: ${merchant.businessName}  ·  Quai wallet ${merchant.quaiAddress}`);

  line("\n[WA merchant → bot] add Red Lipstick 5000");
  await app.whatsapp.handleInbound({ from: merchant.phone, text: "add Red Lipstick 5000" });
  const [product] = await app.commerce.listProducts(merchant.id);

  line(`[WA merchant → bot] sell ${product!.id} 1 +2348090000009 crypto`);
  const reply = await app.whatsapp.handleInbound({
    from: merchant.phone,
    text: `sell ${product!.id} 1 +2348090000009 crypto`,
  });
  line("[bot → merchant]\n" + reply.split("\n").map((l) => "   " + l).join("\n"));

  const order = (await app.repos.orders.listByMerchant(merchant.id))[0]!;
  line(`\n💠 Buyer opens the link in BlipPay and pays ${humanUsdt(koboToUsdtUnits(order.amount))} (= ${formatNaira(order.amount)})`);

  const rail = app.rails.crypto() as QuaiRail;
  const paid = rail.chain!.simulatePayment({
    orderId: order.id,
    merchant: merchant.quaiAddress!,
    token: "0xUSDT",
    amount: koboToUsdtUnits(order.amount),
  });
  line(`   RhodiumPay forwards buyer → merchant in tx ${paid.txHash.slice(0, 18)}… (no custody)`);

  const t0 = Date.now();
  await app.payments.handleRailWebhook("quai", {
    headers: {},
    rawBody: JSON.stringify({ txHash: paid.txHash }),
  });
  line(`\n⚡ Confirmed on-chain + reconciled in ${Date.now() - t0}ms:\n`);
  for (const m of channel.sent.slice(-2)) {
    line(`   [→ ${m.to}]`);
    line(m.message.split("\n").map((l) => "     " + l).join("\n"));
    line();
  }

  const balance = await app.ledger.balance(merchant.id);
  line(`📒 Ledger (naira): ${(await app.ledger.entries(merchant.id)).length} entry · balance ${formatNaira(balance)}`);

  // Idempotency: replay the same on-chain tx → no double count.
  await app.payments.handleRailWebhook("quai", { headers: {}, rawBody: JSON.stringify({ txHash: paid.txHash }) });
  line(`🔁 Replayed same tx → ledger entries: ${(await app.ledger.entries(merchant.id)).length} (idempotent ✓)`);

  const traction = await app.traction.snapshot();
  line("\n📈 Live traction:");
  line(`   GMV ${traction.gmvFormatted} · sales ${traction.salesCount} · buyers ${traction.uniqueBuyers} · ` +
    `rail split → bank ${traction.railSplit.fiat} / crypto ${traction.railSplit.crypto}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
