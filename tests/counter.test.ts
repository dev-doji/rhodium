import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { buildApp } from "../src/app.js";
import { loadConfig, resetConfigCache } from "../src/config/index.js";
import { CaptureTransport } from "../src/modules/notification/transport.js";
import { buildApi } from "../src/http/api.js";
import type { MockableFiatRail } from "./helpers/harness.js";

/**
 * The physical counter: a cashier keys in an amount (or taps products), the
 * buyer scans a QR, and the sale lands in the same ledger as every other.
 *
 * What matters here is that a sale with no catalogue product and no buyer
 * phone survives the whole paid path — stock, receipt and ledger all used to
 * assume both existed.
 */

let server: Server;
let base: string;
let app: ReturnType<typeof buildApp>;
let channel: CaptureTransport;
let authH: Record<string, string>;
let productId: string;

const PHONE = "+2348030007777";

beforeAll(async () => {
  resetConfigCache();
  process.env.NODE_ENV = "test";
  process.env.FIAT_ADAPTER_MODE = "mock";
  process.env.WHATSAPP_MODE = "mock";
  channel = new CaptureTransport("whatsapp");
  app = buildApp({ config: loadConfig(), notificationChannels: [channel] });
  await app.repos.merchants.create({
    id: "mch_counter",
    phone: PHONE,
    businessName: "Balogun Fabrics",
    status: "active",
    kycState: "verified",
    cryptoEnabled: false,
    settlementBankCode: "058",
    settlementAccountNumber: "0123456789",
  });
  const product = await app.commerce.createProduct({
    merchantId: "mch_counter",
    name: "Ankara (6 yards)",
    price: 12_000_00,
    stockQty: 5,
  });
  productId = product.id;

  const api = buildApi(app);
  await new Promise<void>((r) => {
    server = api.listen(0, () => r());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  await fetch(`${base}/auth/otp/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: PHONE }),
  });
  const code = channel.sent.find((s) => s.message.includes("code is"))!.message.match(/code is (\d{6})/)![1];
  const res = await fetch(`${base}/auth/otp/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: PHONE, code }),
  });
  const { token } = (await res.json()) as { token: string };
  authH = { authorization: `Bearer ${token}`, "content-type": "application/json" };
});

afterAll(() => {
  server?.close();
});

interface SaleBody {
  order: { id: string; amount: number; amountFormatted: string; status: string };
  checkoutUrl: string;
  qrUrl: string;
}

const sale = (body: unknown): Promise<Response> =>
  fetch(`${base}/api/counter/sale`, { method: "POST", headers: authH, body: JSON.stringify(body) });

/** Buyer picks bank on the checkout page, then the bank's webhook arrives. */
async function payByBank(orderId: string): Promise<void> {
  const m = await fetch(`${base}/api/checkout/${orderId}/method`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "bank" }),
  });
  expect(m.status).toBe(200);
  const payment = await app.repos.payments.byOrderId(orderId);
  const fiat = app.rails.fiat() as MockableFiatRail;
  const signed = fiat.mock!.simulateTransfer(payment!.providerRef);
  const wh = await fetch(`${base}/webhooks/rails/${fiat.id}`, {
    method: "POST",
    headers: { [fiat.webhookSignatureHeader!]: signed.signature, "content-type": "application/json" },
    body: signed.rawBody,
  });
  expect(wh.status).toBe(200);
}

describe("counter sale", () => {
  it("takes a keyed-in amount from a walk-in buyer all the way to the ledger", async () => {
    const res = await sale({ amountNaira: 3500, note: "Two yards lace" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as SaleBody;
    expect(body.order.amount).toBe(3_500_00);
    // Nothing is issued until the buyer chooses how to pay.
    expect(body.order.status).toBe("draft");
    expect(await app.repos.payments.byOrderId(body.order.id)).toBeNull();
    expect(body.checkoutUrl).toMatch(new RegExp(`/checkout/${body.order.id}$`));

    const qr = await fetch(`${base}${body.qrUrl}`);
    expect(qr.status).toBe(200);
    expect(qr.headers.get("content-type")).toContain("image/svg+xml");
    expect(await qr.text()).toContain("<svg");

    const sentBefore = channel.sent.length;
    await payByBank(body.order.id);

    expect((await app.repos.orders.byId(body.order.id))!.status).toBe("paid");
    const ledger = (await (await fetch(`${base}/api/ledger`, { headers: authH })).json()) as {
      entries: { amount: number }[];
    };
    expect(ledger.entries.map((e) => e.amount)).toContain(3_500_00);

    // The merchant hears about it; nobody tries to WhatsApp "walk-in".
    const sent = channel.sent.slice(sentBefore);
    expect(sent.some((s) => s.to === PHONE)).toBe(true);
    expect(sent.some((s) => s.to === "walk-in")).toBe(false);

    // The receipt names what was keyed in rather than a generic "Item".
    const receipt = (await (await fetch(`${base}/api/receipt/${body.order.id}`)).json()) as {
      items: { name: string; unitPrice: number }[];
    };
    expect(receipt.items).toEqual([expect.objectContaining({ name: "Two yards lace", unitPrice: 3_500_00 })]);
  });

  it("sells catalogue products and takes them out of stock", async () => {
    const res = await sale({ lines: [{ productId, qty: 2 }], buyerPhone: "08090001234" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as SaleBody;
    expect(body.order.amount).toBe(24_000_00);

    await payByBank(body.order.id);

    expect((await app.repos.products.byId(productId))!.stockQty).toBe(3);
    // A buyer who gave a number gets the receipt there too, in E.164.
    expect(channel.sent.some((s) => s.to === "+2348090001234" && s.message.includes("Receipt"))).toBe(true);
  });

  it("will not hand a bank account to a buyer who asked to pay in crypto", async () => {
    // The cashier shows the account number; the buyer's phone then taps crypto.
    const { order } = (await (await sale({ amountNaira: 5000 })).json()) as SaleBody;
    const method = (m: string): Promise<Response> =>
      fetch(`${base}/api/checkout/${order.id}/method`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: m }),
      });
    expect((await method("bank")).status).toBe(200);

    const res = await method("crypto");
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; instruction: { instructionType: string } };
    expect(body.error).toBe("method_locked");
    // The page gets the real instruction to show, labelled for what it is.
    expect(body.instruction.instructionType).toBe("dva");
    // And the order still says bank, so traction counts it where it was paid.
    expect((await app.repos.orders.byId(order.id))!.rail).toBe("fiat");
  });

  it("refuses an amount and a cart together, or neither", async () => {
    expect((await sale({ amountNaira: 100, lines: [{ productId, qty: 1 }] })).status).toBe(422);
    expect((await sale({})).status).toBe(422);
  });

  it("refuses a zero, negative or non-numeric amount", async () => {
    for (const amountNaira of [0, -50, "abc"]) {
      expect((await sale({ amountNaira })).status).toBe(422);
    }
  });

  it("will not price a line from the request body", async () => {
    // A cart line carrying its own price must be rebuilt as product + qty.
    const res = await sale({ lines: [{ productId, qty: 1, name: "x", unitPrice: 1 }] });
    const body = (await res.json()) as SaleBody;
    expect(body.order.amount).toBe(12_000_00);
  });

  it("refuses a buyer phone it cannot reach", async () => {
    expect((await sale({ amountNaira: 500, buyerPhone: "12" })).status).toBe(422);
  });

  it("is merchant-only", async () => {
    const res = await fetch(`${base}/api/counter/sale`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amountNaira: 500 }),
    });
    expect(res.status).toBe(401);
  });

  it("404s a QR for an order that does not exist", async () => {
    expect((await fetch(`${base}/api/checkout/ord_nope/qr.svg`)).status).toBe(404);
  });
});
