import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { buildApp } from "../src/app.js";
import { loadConfig, resetConfigCache } from "../src/config/index.js";
import { CaptureTransport } from "../src/modules/notification/transport.js";
import { buildApi } from "../src/http/api.js";
import { MonnifyFiatRail } from "../src/rails/monnify-fiat-rail.js";

let server: Server;
let base: string;
let channel: CaptureTransport;
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  resetConfigCache();
  process.env.NODE_ENV = "test";
  process.env.FIAT_ADAPTER_MODE = "mock";
  process.env.WHATSAPP_MODE = "mock";
  channel = new CaptureTransport("whatsapp");
  app = buildApp({ config: loadConfig(), notificationChannels: [channel] });
  await app.repos.merchants.create({
    id: "mch_http",
    phone: "+2348030001111",
    businessName: "HTTP Store",
    status: "active",
    kycState: "verified",
    cryptoEnabled: false,
  });
  const api = buildApi(app);
  await new Promise<void>((r) => {
    server = api.listen(0, () => r());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server?.close();
});

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function login(): Promise<string> {
  await fetch(`${base}/auth/otp/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: "+2348030001111" }),
  });
  const code = channel.sent.find((s) => s.message.includes("code is"))!.message.match(/code is (\d{6})/)![1];
  const res = await fetch(`${base}/auth/otp/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: "+2348030001111", code }),
  });
  return (await json<{ token: string }>(res)).token;
}

describe("HTTP API — end-to-end over the wire", () => {
  it("health + metrics are up", async () => {
    expect((await json<{ ok: boolean }>(await fetch(`${base}/health`))).ok).toBe(true);
    expect(await json(await fetch(`${base}/metrics`))).toBeTypeOf("object");
  });

  it("runs the full loop: login → product → order(DVA) → webhook → ledger", async () => {
    const token = await login();
    const authH = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const prodRes = await fetch(`${base}/api/products`, {
      method: "POST",
      headers: authH,
      body: JSON.stringify({ name: "Serum", priceNaira: 7500 }),
    });
    const { product } = await json<{ product: { id: string; price: number } }>(prodRes);
    expect(product.price).toBe(750_000);

    const orderRes = await fetch(`${base}/api/orders`, {
      method: "POST",
      headers: authH,
      body: JSON.stringify({ buyerPhone: "+2348090002222", lines: [{ productId: product.id, qty: 1 }] }),
    });
    const { order, instruction } = await json<{
      order: { id: string };
      instruction: { accountNumber: string };
    }>(orderRes);
    expect(instruction.accountNumber).toMatch(/^\d{10}$/);

    // Buyer transfers → provider posts the signed webhook to our endpoint.
    const payment = await app.repos.payments.byOrderId(order.id);
    const fiat = app.rails.fiat() as MonnifyFiatRail;
    const signed = fiat.mock!.simulateTransfer(payment!.providerRef);
    const wh = await fetch(`${base}/webhooks/rails/monnify`, {
      method: "POST",
      headers: { "monnify-signature": signed.signature, "content-type": "application/json" },
      body: signed.rawBody,
    });
    expect(wh.status).toBe(200);

    const ledger = await json<{ balance: number; entries: unknown[] }>(
      await fetch(`${base}/api/ledger`, { headers: authH }),
    );
    expect(ledger.balance).toBe(750_000);
    expect(ledger.entries).toHaveLength(1);

    const summary = await json<{ count: number }>(
      await fetch(`${base}/api/summary`, { headers: authH }),
    );
    expect(summary.count).toBe(1);

    const csv = await (await fetch(`${base}/api/ledger/export.csv`, { headers: authH })).text();
    expect(csv).toContain("amount_naira");
    expect(csv).toContain("7500.00");
  });

  it("rejects unauthenticated dashboard access", async () => {
    expect((await fetch(`${base}/api/products`)).status).toBe(401);
  });

  it("rejects a forged rail webhook signature (401)", async () => {
    const res = await fetch(`${base}/webhooks/rails/monnify`, {
      method: "POST",
      headers: { "monnify-signature": "bad", "content-type": "application/json" },
      body: JSON.stringify({ event: "charge.success", data: {} }),
    });
    expect(res.status).toBe(401);
  });

  it("verifies the WhatsApp webhook subscription handshake", async () => {
    const res = await fetch(
      `${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=rhodium-verify&hub.challenge=42`,
    );
    expect(await res.text()).toBe("42");
  });

  it("routes an inbound webhook to the vendor who owns the number it arrived on", async () => {
    const vendor = await app.repos.merchants.create({
      id: "mch_tenant_http",
      phone: "+2348030002222",
      businessName: "Tenant Store",
      status: "active",
      kycState: "verified",
      cryptoEnabled: false,
      waPhoneNumberId: "PNID_TENANT_HTTP",
    });
    await app.commerce.createProduct({
      merchantId: vendor.id, name: "Shea Butter", price: 250_000,
    });

    const res = await fetch(`${base}/webhooks/whatsapp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: {
                    display_phone_number: "+234 803 680 3974",
                    phone_number_id: "PNID_TENANT_HTTP",
                  },
                  messages: [
                    { from: "2348090001234", type: "text", text: { body: "good afternoon" } },
                  ],
                },
              },
            ],
          },
        ],
      }),
    });
    expect(res.status).toBe(200);

    const answer = channel.sent.at(-1)!;
    expect(answer.message).toContain("Tenant Store");
    expect(answer.message).toContain("Shea Butter");
    expect(answer.from).toBe("PNID_TENANT_HTTP");
  });

  it("stands the bot down when a coexistence echo says the vendor replied", async () => {
    const buyer = "2348090005678";
    const post = (body: unknown) =>
      fetch(`${base}/webhooks/whatsapp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const inbound = {
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: "PNID_TENANT_HTTP" },
        messages: [{ from: buyer, type: "text", text: { body: "hello" } }],
      } }] }],
    };

    await post(inbound);
    expect(channel.sent.at(-1)!.message).toContain("Tenant Store");

    // She answers from the WhatsApp Business app; Meta echoes it to us.
    await post({
      entry: [{ changes: [{ field: "smb_message_echoes", value: {
        metadata: { phone_number_id: "PNID_TENANT_HTTP" },
        message_echoes: [{
          from: "2348036803974", to: buyer, type: "text",
          text: { body: "Hi dear, yes we're open!" },
        }],
      } }] }],
    });

    const before = channel.sent.length;
    await post(inbound);
    expect(channel.sent.length).toBe(before); // bot said nothing
  });

  it("ignores a coexistence history payload instead of replaying it", async () => {
    const before = channel.sent.length;
    // Up to 6 months of old chat arrives on its own path. If this ever reached
    // the inbound router it would create orders from messages sent months ago.
    const res = await fetch(`${base}/webhooks/whatsapp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "history",
        data: {
          history: [{
            metadata: { phone_number_id: "PNID_TENANT_HTTP" },
            threads: [{
              id: "2348090005678",
              messages: [{ from: "2348090005678", type: "text", text: { body: "1" } }],
            }],
          }],
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(channel.sent.length).toBe(before);
  });


  it("rejects a WhatsApp webhook that is not signed by Meta", async () => {
    // The rails have always verified their signatures; this endpoint did not.
    // A forged payload naming a merchant's phone is treated AS that merchant,
    // so an unsigned POST could add products or read a shop's books.
    const { createHmac } = await import("node:crypto");
    const secret = "test-app-secret";
    const prev = app.config.WHATSAPP_APP_SECRET;
    (app.config as { WHATSAPP_APP_SECRET: string }).WHATSAPP_APP_SECRET = secret;
    try {
      const body = JSON.stringify({
        entry: [{ changes: [{ value: {
          metadata: { phone_number_id: "PNID_TENANT_HTTP" },
          messages: [{ from: "2348090009999", type: "text", text: { body: "hi" } }],
        } }] }],
      });
      const before = channel.sent.length;

      const forged = await fetch(`${base}/webhooks/whatsapp`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef" },
        body,
      });
      expect(forged.status).toBe(401);
      expect(channel.sent.length).toBe(before);

      const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
      const genuine = await fetch(`${base}/webhooks/whatsapp`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": sig },
        body,
      });
      expect(genuine.status).toBe(200);
      expect(channel.sent.length).toBeGreaterThan(before);
    } finally {
      (app.config as { WHATSAPP_APP_SECRET: string }).WHATSAPP_APP_SECRET = prev;
    }
  });

  it("rejects an Embedded Signup callback with a forged state", async () => {
    const res = await fetch(
      `${base}/oauth/whatsapp/callback?code=CODE&state=mch_http.deadbeef`,
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Couldn't connect/);
  });

  it("shows a readable page when a vendor cancels Embedded Signup", async () => {
    const res = await fetch(
      `${base}/oauth/whatsapp/callback?error=access_denied&error_description=User+cancelled`,
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/cancelled/i);
  });

  it("runs the crypto (Quai/BlipPay) checkout loop and reflects it in traction", async () => {
    // A crypto-capable merchant with a Quai wallet + a crypto order.
    const merchant = await app.repos.merchants.create({
      id: "mch_crypto_http",
      phone: "+2348030007777",
      businessName: "Crypto Store",
      status: "active",
      kycState: "verified",
      cryptoEnabled: true,
      quaiAddress: "0xMerchantWallet",
    });
    const product = await app.commerce.createProduct({
      merchantId: merchant.id, name: "Serum", price: 800_000,
    });
    const order = await app.commerce.createOrder({
      merchantId: merchant.id, buyerRef: "+2348090008888",
      lines: [{ productId: product.id, qty: 1 }], rail: "crypto",
    });

    // Checkout page data (buyer-facing, no auth).
    const checkout = await json<{
      instruction: { instructionType: string; checkoutUrl: string; cryptoAmount: string };
      order: { rail: string };
    }>(await fetch(`${base}/api/checkout/${order.id}`));
    expect(checkout.order.rail).toBe("crypto");
    expect(checkout.instruction.instructionType).toBe("crypto");
    expect(checkout.instruction.checkoutUrl).toContain(`/checkout/${order.id}`);

    // Simulate the BlipPay payment (dev/mock path the checkout button uses).
    const pay = await fetch(`${base}/api/crypto/simulate-pay`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: order.id }),
    });
    expect(pay.status).toBe(200);

    // Order is paid; the sale is in the naira ledger + the traction feed.
    const after = await app.repos.orders.byId(order.id);
    expect(after!.status).toBe("paid");
    const traction = await json<{ railSplit: { crypto: number }; salesCount: number }>(
      await fetch(`${base}/api/traction`),
    );
    expect(traction.railSplit.crypto).toBeGreaterThanOrEqual(1);
  });

  it("serves the checkout + traction pages", async () => {
    expect(await (await fetch(`${base}/checkout/anything`)).text()).toContain("BlipPay");
    expect(await (await fetch(`${base}/traction`)).text()).toContain("Traction");
  });
});
