/**
 * End-to-end test of the WhatsApp BOT ITSELF, printed as a chat transcript.
 *
 * `npm run demo:whatsapp`
 *
 * Unlike `npm run demo` (which creates the merchant directly via the repos and
 * only exercises two commands), this drives every message through
 * `whatsapp.handleInbound` exactly as the Cloud API webhook would — vendor
 * onboarding, the command menu, the buyer storefront on a second phone, payment,
 * and the receipt landing back in the chat.
 *
 * Runs entirely on mocks: it passes a CaptureTransport, which REPLACES the live
 * WhatsApp transport in buildApp, so no real messages are sent even though
 * .env has WHATSAPP_MODE=live. Needs no phone, no deploy and no Meta approval —
 * use it to check bot copy and flow before pushing.
 */
import { loadEnv } from "../config/load-env.js";
loadEnv();
import { buildApp } from "../app.js";
import { loadConfig } from "../config/index.js";
import { CaptureTransport } from "../modules/notification/transport.js";
import { MonnifyFiatRail } from "../rails/monnify-fiat-rail.js";
import { formatNaira } from "../lib/money.js";

const VENDOR = "+2348030000042";
const BUYER = "+2348090000009";

async function main(): Promise<void> {
  process.env.NODE_ENV = "development";
  // Force every rail to mock BEFORE loadConfig() reads (and caches) the env.
  // .env is set up for the live deployment, so without this the demo issues a
  // REAL Monnify sandbox reserved account and would hit Orchard for the crypto
  // path — side effects a local bot test has no business creating.
  process.env.FIAT_ADAPTER_MODE = "mock";
  process.env.QUAI_ADAPTER_MODE = "mock";
  process.env.ONSWITCH_ADAPTER_MODE = "mock";
  process.env.WHATSAPP_MODE = "mock";
  const config = loadConfig();
  const capture = new CaptureTransport("whatsapp");
  const app = buildApp({ config, notificationChannels: [capture] });

  const say = (who: string, text: string) => {
    console.log(`\n\x1b[36m[${who} → bot]\x1b[0m ${text}`);
  };
  const bot = (text: string) => {
    console.log(`\x1b[32m[bot]\x1b[0m\n${text.split("\n").map((l) => "   " + l).join("\n")}`);
  };
  const beat = (t: string) => console.log(`\n\x1b[33m── ${t} ──\x1b[0m`);

  const send = async (from: string, text: string, label: string): Promise<string> => {
    say(label, text);
    const reply = await app.whatsapp.handleInbound({ from, text });
    bot(reply);
    return reply;
  };

  console.log("=== Rhodium — WhatsApp bot, end to end ===");

  beat("1. Vendor's first ever message (the wa.me link)");
  await send(VENDOR, "Hi Rhodium — I want to start selling on WhatsApp.", "vendor");

  beat("2. Vendor reflexively types a command instead of a name");
  await send(VENDOR, "menu", "vendor");

  beat("3. Onboarding: name → account → bank");
  await send(VENDOR, "Amaka Beauty", "vendor");
  await send(VENDOR, "0123456789", "vendor");
  await send(VENDOR, "2", "vendor"); // GTBank

  const merchant = await app.repos.merchants.byPhone(VENDOR);
  if (!merchant) throw new Error("onboarding did not create a merchant");
  console.log(`\n   ✔ merchant ${merchant.id} — wallet ${merchant.quaiAddress ?? "(none)"}`);

  beat("4. The command menu");
  await send(VENDOR, "menu", "vendor");

  beat("5. Build the catalogue");
  await send(VENDOR, "add Red Lipstick 5000", "vendor");
  await send(VENDOR, "add Gloss Set 12000", "vendor");
  await send(VENDOR, "list", "vendor");

  beat("6. Vendor grabs the shop link");
  const link = await send(VENDOR, "link", "vendor");
  if (link.includes("15551405536")) {
    console.log("\n   \x1b[31m✗ shop link points at the RETIRED test number\x1b[0m");
  }

  beat("7. Buyer opens that link on a DIFFERENT phone");
  await send(BUYER, `shop-${merchant.id}`, "buyer");

  beat("8. Buyer picks product 1, then pays by bank transfer");
  await send(BUYER, "1", "buyer");
  await send(BUYER, "1", "buyer"); // 1 = bank transfer

  beat("9. Buyer actually transfers — Monnify fires its signed webhook");
  const order = (await app.repos.orders.listByMerchant(merchant.id))[0];
  if (!order) throw new Error("no order was created by the buyer flow");
  const payment = await app.repos.payments.byOrderId(order.id);
  if (!payment) throw new Error("no payment record for the order");
  const fiat = app.rails.fiat() as MonnifyFiatRail;
  const hook = fiat.mock!.simulateTransfer(payment.providerRef);
  const t0 = Date.now();
  await app.payments.handleRailWebhook("monnify", {
    headers: { "monnify-signature": hook.signature },
    rawBody: hook.rawBody,
  });
  console.log(`   ⚡ confirmed in ${Date.now() - t0}ms`);

  beat("10. What actually landed in each person's WhatsApp");
  for (const m of capture.sent) {
    console.log(`\n\x1b[32m[bot → ${m.to}]\x1b[0m`);
    console.log(m.message.split("\n").map((l) => "   " + l).join("\n"));
  }

  beat("11. Vendor checks the books");
  await send(VENDOR, "ledger", "vendor");

  const finalOrder = await app.repos.orders.byId(order.id);
  const balance = await app.ledger.balance(merchant.id);
  console.log(
    `\n📒 order ${finalOrder!.status}  |  balance ${formatNaira(balance)}  |  ` +
      `${capture.sent.length} notification(s) delivered`,
  );

  if (finalOrder!.status !== "paid") throw new Error(`order ended ${finalOrder!.status}, expected paid`);
  console.log("\n\x1b[32m✅ WhatsApp bot end-to-end: PASS\x1b[0m");
}

main().catch((err) => {
  console.error(`\n✗ ${(err as Error).message}`);
  process.exit(1);
});
