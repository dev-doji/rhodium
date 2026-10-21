/**
 * Try counter mode by hand, on this machine, with no real money anywhere.
 *
 *   npm run demo:counter
 *
 * Boots the real API + dashboard in memory with every rail mocked, seeds a
 * shop, and prints sign-in codes to this terminal instead of WhatsApp. Opening
 * /dev/pay in a second tab plays the part of the buyer's bank: it "transfers"
 * into the newest unpaid sale, and the counter screen chimes.
 *
 * Every live switch is forced off BEFORE .env is read, because values already
 * in the environment win over the file. A developer's .env holds live Paystack
 * and WhatsApp keys, and a test tool that quietly used them would create real
 * accounts and message real people.
 */
import { networkInterfaces } from "node:os";
import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const PORT = Number(process.env.COUNTER_PORT ?? 3000);

/** This machine's address on the local network, so a phone can scan the QR. */
function lanAddress(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return null;
}
const lan = lanAddress();
const origin = `http://${lan ?? "localhost"}:${PORT}`;

Object.assign(process.env, {
  NODE_ENV: "development",
  DATABASE_URL: "",
  PORT: String(PORT),
  PUBLIC_BASE_URL: origin,
  MERCHANT_BASE_URL: origin,
  FIAT_ADAPTER_MODE: "mock",
  WHATSAPP_MODE: "mock",
  EMAIL_MODE: "mock",
  ONSWITCH_ADAPTER_MODE: "mock",
  EVM_ADAPTER_MODE: "mock",
  QUAI_ADAPTER_MODE: "mock",
  // The mocks sign their fake webhooks with these. Blanked so a live key from
  // .env is never even loaded into a process that exists to pretend.
  PAYSTACK_SECRET_KEY: "",
  MONNIFY_API_KEY: "",
  MONNIFY_SECRET_KEY: "",
  ONSWITCH_SERVICE_KEY: "",
});

const { loadEnv } = await import("../config/load-env.js");
loadEnv();
const { buildApp } = await import("../app.js");
const { loadConfig } = await import("../config/index.js");
const { buildApi } = await import("../http/api.js");
const { formatNaira } = await import("../lib/money.js");
type Transport = import("../modules/notification/transport.js").NotificationTransport;
type Signed = { signature: string; rawBody: string };
type MockableRail = import("../rails/types.js").PaymentRail & {
  mock?: {
    simulateTransfer?(ref: string): Signed; // bank rails
    complete?(ref: string): Signed; // OnSwitch off-ramp
  };
};

const PHONE = "+2348030000001";

/** WhatsApp stand-in: sign-in codes and receipts land in this terminal. */
const terminal: Transport = {
  channel: "whatsapp",
  async send(to, message) {
    const code = /code is (\d{6})/.exec(message)?.[1];
    console.log(code ? `\n🔑 Sign-in code for ${to}: ${code}\n` : `\n💬 WhatsApp → ${to}\n${message}\n`);
    return { ok: true };
  },
};

const app = buildApp({ config: loadConfig(), notificationChannels: [terminal] });

const merchant = await app.repos.merchants.create({
  id: "mch_counter_demo",
  phone: PHONE,
  businessName: "Balogun Fabrics",
  slug: "balogunfabrics",
  status: "active",
  kycState: "verified",
  cryptoEnabled: false,
  settlementBankCode: "058",
  settlementAccountNumber: "0123456789",
});
for (const [name, naira, stock] of [
  ["Ankara (6 yards)", 12_000, 10],
  ["Lace (per yard)", 3_500, undefined],
  ["Aso-oke headtie", 8_000, 4],
] as const) {
  await app.commerce.createProduct({ merchantId: merchant.id, name, price: naira * 100, stockQty: stock });
}

const outer = express();

/** The newest sale nobody has paid yet. */
async function newestUnpaid(): Promise<string | null> {
  const open = (await app.repos.orders.listByMerchant(merchant.id))
    .filter((o) => o.status === "draft" || o.status === "awaiting_payment")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return open[0]?.id ?? null;
}

/**
 * Play the buyer's side of a payment, on whichever method the sale is set up
 * for: a bank transfer into the account number, or a stablecoin deposit that
 * the off-ramp settles to the seller in naira.
 *
 * A sale nobody has chosen a method for yet is paid by bank, and gets its
 * account number first — exactly what a buyer tapping "bank" would cause.
 * Either way a signed webhook goes through the same signature check and
 * confirmation path as a real one; nothing here marks an order paid directly.
 */
async function simulatePayment(orderId: string): Promise<string> {
  const order = await app.repos.orders.byId(orderId);
  if (!order) throw new Error("no such sale");
  if (order.status === "paid") return `${formatNaira(order.amount)} was already paid`;

  if (!(await app.repos.payments.byOrderId(order.id))) {
    const fiat = app.rails.fiat();
    if (order.rail !== "fiat") await app.repos.orders.setRail(order.id, "fiat");
    await app.payments.requestPayment(order.id, fiat.id);
  }
  const payment = (await app.repos.payments.byOrderId(order.id))!;
  const rail = app.rails.get(payment.railId) as MockableRail;

  let headers: Record<string, string>;
  let signed: Signed;
  if (rail.mock?.simulateTransfer) {
    signed = rail.mock.simulateTransfer(payment.providerRef);
    headers = { [rail.webhookSignatureHeader!]: signed.signature };
  } else if (rail.mock?.complete) {
    signed = rail.mock.complete(payment.providerRef);
    headers = { "x-switch-signature": signed.signature };
  } else {
    throw new Error(`cannot fake a payment on the ${rail.id} rail`);
  }
  await app.payments.handleRailWebhook(rail.id, { headers, rawBody: signed.rawBody });
  const how = rail.kind === "crypto" ? "a crypto payment" : "a bank transfer";
  return `Simulated ${how} of ${formatNaira(order.amount)}`;
}

outer.use(express.json());

/** Pay one sale by id (the checkout button), or the newest one (the dashboard). */
outer.post(["/dev/pay", "/dev/pay/:orderId"], async (req, res) => {
  try {
    const orderId = req.params.orderId ?? (await newestUnpaid());
    if (!orderId) {
      res.status(404).json({ message: "Nothing to pay — press Charge on the counter first." });
      return;
    }
    res.json({ message: await simulatePayment(orderId) });
  } catch (e) {
    res.status(500).json({ message: (e as Error).message });
  }
});

/** The same, from a plain browser tab. */
outer.get("/dev/pay", async (_req, res) => {
  try {
    const orderId = await newestUnpaid();
    if (!orderId) {
      res.type("html").send(page("Nothing to pay", "Press <b>Charge</b> on the counter first, then reload this tab."));
      return;
    }
    const message = await simulatePayment(orderId);
    res.type("html").send(
      page(message, `The counter screen should chime now. <a href="/receipt/${orderId}">Receipt</a> · reload to pay the next sale.`),
    );
  } catch (e) {
    res.status(500).type("html").send(page("That did not work", String((e as Error).message)));
  }
});

/**
 * The real checkout page and dashboard, with a test-mode bar stitched in.
 *
 * Done here rather than in the pages themselves so production HTML carries no
 * trace of a "simulate payment" button — the bar only exists while this
 * launcher is serving.
 */
const withTestBar = (file: string, target: "this" | "newest") => (_req: express.Request, res: express.Response) => {
  res.set("Cache-Control", "no-store");
  res.type("html").send(readFileSync(file, "utf8").replace("</body>", `${testBar(target)}</body>`));
};
outer.get("/checkout/:orderId", withTestBar(resolve("public/checkout.html"), "this"));
if (existsSync(resolve("dashboard/dist/index.html"))) {
  outer.get(["/", "/index.html"], withTestBar(resolve("dashboard/dist/index.html"), "newest"));
}

outer.use(buildApi(app));

outer.listen(PORT, () => {
  console.log(`
────────────────────────────────────────────────────────────
 Rhodium counter — local test (in memory, every rail mocked)
────────────────────────────────────────────────────────────
 1. Open the dashboard:   http://localhost:${PORT}
 2. Sign in with:         ${PHONE}   (the code appears below)
 3. Click "Counter", type an amount, press Charge.
 4. Pay it from another tab: http://localhost:${PORT}/dev/pay
${lan ? ` Phone on the same Wi-Fi? Scan the QR — it opens ${origin}\n` : ""} Stop with Ctrl+C. Nothing is saved.
`);
});

/**
 * A bar along the bottom of the page: says plainly that nothing is real, and
 * offers the one thing a tester cannot otherwise do — make the money arrive.
 */
function testBar(target: "this" | "newest"): string {
  const url = target === "this" ? "'/dev/pay/' + location.pathname.split('/').pop()" : "'/dev/pay'";
  const label = target === "this" ? "Simulate payment" : "Simulate payment for the latest sale";
  return `
<div id="rh-test" role="note" style="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#7a4b00;color:#fff;font:600 14px/1.3 system-ui,sans-serif;padding:10px 16px;display:flex;gap:10px 14px;align-items:center;justify-content:center;flex-wrap:wrap;text-align:center">
  <span>TEST MODE — dummy payments only. Do not send real money.</span>
  <button id="rh-pay" type="button" style="font:inherit;background:#fff;color:#7a4b00;border:0;padding:8px 14px;cursor:pointer">${label}</button>
  <span id="rh-msg" aria-live="polite"></span>
</div>
<script>
  document.body.style.paddingBottom = "80px";
  document.getElementById("rh-pay").onclick = async function () {
    var msg = document.getElementById("rh-msg");
    this.disabled = true; msg.textContent = "Paying…";
    try {
      var r = await fetch(${url}, { method: "POST" });
      var b = await r.json();
      msg.textContent = b.message || (r.ok ? "Done" : "Failed");
    } catch (e) { msg.textContent = "Failed: " + e.message; }
    this.disabled = false;
  };
</script>`;
}

function page(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${title}</title><body style="font:18px system-ui;max-width:520px;margin:48px auto;padding:0 16px">
<h1>${title}</h1><p>${body}</p></body>`;
}
