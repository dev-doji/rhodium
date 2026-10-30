import { describe, it, expect, afterAll } from "vitest";
import type { Server } from "node:http";
import { buildApp, type App } from "../src/app.js";
import { loadConfig, resetConfigCache } from "../src/config/index.js";
import { CaptureTransport } from "../src/modules/notification/transport.js";
import { InMemoryAuditSink } from "../src/modules/audit/audit-service.js";
import { FixedClock } from "../src/lib/clock.js";
import { buildRegistry } from "../src/rails/registry.js";
import { NearIntentsRail } from "../src/rails/near-intents-rail.js";
import { ftTransfersTo, type NearTxResult } from "../src/rails/near-rpc.js";
import { isRefundAddressFor } from "../src/rails/near-assets.js";
import { NearPaymentPoller } from "../src/jobs/near-payment-poller.js";
import { buildApi } from "../src/http/api.js";
import { AppError } from "../src/lib/errors.js";
import type { Order } from "../src/domain/types.js";

/**
 * NEAR Intents, end to end in mock mode: a buyer pays any token, a solver
 * delivers USDC to the merchant's own NEAR account, and the order is credited
 * only once the (mock) NEAR chain shows that transfer.
 */

const USDT_TRON = "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near";
const TRON_REFUND = "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8";
const MERCHANT_NEAR = "amaka.rhodium.near";

function makeNearApp() {
  resetConfigCache();
  process.env.NODE_ENV = "test";
  process.env.FIAT_ADAPTER_MODE = "mock";
  process.env.WHATSAPP_MODE = "mock";
  process.env.FEATURE_NEAR_ENABLED = "true";
  process.env.NEAR_ADAPTER_MODE = "mock";
  const config = loadConfig();
  const clock = new FixedClock(new Date("2026-11-03T09:00:00Z"));
  const channel = new CaptureTransport("whatsapp");
  const audit = new InMemoryAuditSink();
  const app = buildApp({ config, clock, notificationChannels: [channel], auditSink: audit });
  const rail = app.rails.get("near_intents") as NearIntentsRail;
  return { app, clock, channel, audit, rail };
}

afterAll(() => {
  delete process.env.FEATURE_NEAR_ENABLED;
  delete process.env.NEAR_ADAPTER_MODE;
  resetConfigCache();
});

async function seed(app: App, nearAccountId: string | null = MERCHANT_NEAR, ttlMs?: number) {
  const merchant = await app.repos.merchants.create({
    id: `mch_${Math.random().toString(36).slice(2, 8)}`,
    phone: "+2348030000042",
    businessName: "Amaka Beauty",
    status: "active",
    kycState: "verified",
    cryptoEnabled: true,
    cryptoSettlement: nearAccountId ? "near_usdc" : undefined,
    nearAccountId: nearAccountId ?? undefined,
  });
  const product = await app.commerce.createProduct({
    merchantId: merchant.id,
    name: "Shea Butter",
    price: 350_000, // ₦3,500
  });
  const order: Order = await app.commerce.createOrder({
    merchantId: merchant.id,
    buyerRef: "+2348090001234",
    lines: [{ productId: product.id, qty: 1 }],
    rail: "crypto",
    ttlMs,
  });
  return { merchant, order };
}

const quote = (app: App, orderId: string, over: { originAsset?: string; refundTo?: string } = {}) =>
  app.payments.requestPayment(orderId, "near_intents", {
    originAsset: USDT_TRON,
    refundTo: TRON_REFUND,
    ...over,
  });

describe("NearIntentsRail — quoting", () => {
  it("issues a unique deposit address that pays the merchant's own NEAR account", async () => {
    const { app } = makeNearApp();
    const { order } = await seed(app);
    const inst = await quote(app, order.id);

    expect(inst.railId).toBe("near_intents");
    expect(inst.providerRef).toBe(inst.depositAddress);
    expect(inst.merchantAddress).toBe(MERCHANT_NEAR);
    expect(inst.refundTo).toBe(TRON_REFUND);
    expect(inst.network).toBe("Tron");
    expect(inst.tokenSymbol).toBe("USDT");
    expect(inst.expiresAt).toBeInstanceOf(Date);
    // ₦3,500 at the default ₦1,600/$ = 2.1875 USDC, six decimals.
    expect(inst.settleUnits).toBe("2187500");
    expect(inst.settlesTo).toBe(`2.1875 USDC → ${MERCHANT_NEAR}`);
    // Never base units on the buyer's screen.
    expect(inst.cryptoAmountDisplay).toMatch(/^\d+\.\d+$/);

    const { order: second } = await seed(app);
    expect((await quote(app, second.id)).depositAddress).not.toBe(inst.depositAddress);
  });

  it("refuses a merchant with no NEAR account, an unknown token, or a bad refund address", async () => {
    const { app } = makeNearApp();
    const noAccount = await seed(app, null);
    await expect(quote(app, noAccount.order.id)).rejects.toMatchObject({ status: 409 });

    const { order } = await seed(app);
    await expect(quote(app, order.id, { originAsset: "nep141:fake.near" })).rejects.toMatchObject({ status: 422 });
    // An EVM address offered for a Tron payment: a refund there could not land.
    await expect(
      quote(app, order.id, { refundTo: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D" }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(quote(app, order.id, { refundTo: "" })).rejects.toBeInstanceOf(AppError);
  });

  it("checks refund address shapes per chain", () => {
    expect(isRefundAddressFor("tron", TRON_REFUND)).toBe(true);
    expect(isRefundAddressFor("base", "0x2527D02599Ba641c19FEa793cD0F167589a0f10D")).toBe(true);
    expect(isRefundAddressFor("base", TRON_REFUND)).toBe(false);
    expect(isRefundAddressFor("sol", "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK")).toBe(true);
    expect(isRefundAddressFor("btc", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toBe(true);
    expect(isRefundAddressFor("near", "buyer.near")).toBe(true);
    expect(isRefundAddressFor("near", "Buyer.NEAR")).toBe(false);
  });
});

describe("NearIntentsRail — confirming against the chain", () => {
  it("credits the sale once USDC lands on chain, and tells the merchant where", async () => {
    const { app, channel, rail } = makeNearApp();
    const { merchant, order } = await seed(app);
    const inst = await quote(app, order.id);

    expect(await app.payments.reconcileByPolling(inst.providerRef)).toBe(false); // nothing sent yet

    rail.mock!.pay(inst.providerRef, "success");
    expect(await app.payments.reconcileByPolling(inst.providerRef)).toBe(true);

    expect((await app.repos.orders.byId(order.id))!.status).toBe("paid");
    const entries = await app.ledger.entries(merchant.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.amount).toBe(350_000); // the naira agreed, not a re-converted figure
    const alert = channel.sent.find((m) => m.to === merchant.phone);
    expect(alert?.message).toContain(`2.1875 USDC landed in ${MERCHANT_NEAR}`);
  });

  it("polling twice credits the ledger once", async () => {
    const { app, rail } = makeNearApp();
    const { merchant, order } = await seed(app);
    const inst = await quote(app, order.id);
    rail.mock!.pay(inst.providerRef, "success");
    await app.payments.reconcileByPolling(inst.providerRef);
    await app.payments.reconcileByPolling(inst.providerRef);
    expect(await app.ledger.entries(merchant.id)).toHaveLength(1);
  });

  it("keeps waiting while the deposit is incomplete or being swapped", async () => {
    const { app, rail } = makeNearApp();
    const { order } = await seed(app);
    const inst = await quote(app, order.id);
    rail.mock!.pay(inst.providerRef, "incomplete");
    expect(await app.payments.reconcileByPolling(inst.providerRef)).toBe(false);
    expect((await app.repos.payments.byOrderId(order.id))!.status).toBe("pending");
    expect(await rail.phase(inst.providerRef)).toBe("waiting");
  });

  it("records a refund as failed, not pending forever", async () => {
    const { app, rail } = makeNearApp();
    const { order } = await seed(app);
    const inst = await quote(app, order.id);
    rail.mock!.pay(inst.providerRef, "refund");
    expect(await app.payments.reconcileByPolling(inst.providerRef)).toBe(false);
    expect((await app.repos.payments.byOrderId(order.id))!.status).toBe("failed");
    expect((await app.repos.orders.byId(order.id))!.status).not.toBe("paid");
  });

  it("does NOT credit when 1Click says SUCCESS but the USDC went to someone else", async () => {
    const { app, rail, audit } = makeNearApp();
    const { merchant, order } = await seed(app);
    const inst = await quote(app, order.id);
    rail.mock!.pay(inst.providerRef, "wrong_recipient");

    await expect(app.payments.reconcileByPolling(inst.providerRef)).rejects.toBeInstanceOf(AppError);
    expect((await app.repos.orders.byId(order.id))!.status).not.toBe("paid");
    expect(await app.ledger.entries(merchant.id)).toHaveLength(0);
    const flagged = audit.entries.find((e) => e.action === "payment.recipient_mismatch");
    expect(flagged?.metadata).toMatchObject({ expected: MERCHANT_NEAR, received: "someone-else.near" });
  });

  it("records an underpayment when the chain shows less USDC than quoted", async () => {
    const { app, rail } = makeNearApp();
    const { merchant, order } = await seed(app);
    const inst = await quote(app, order.id);
    rail.mock!.pay(inst.providerRef, "short");
    await app.payments.reconcileByPolling(inst.providerRef);
    expect((await app.repos.payments.byOrderId(order.id))!.status).toBe("underpaid");
    expect(await app.ledger.entries(merchant.id)).toHaveLength(0);
  });

  it("records a payment that arrives after the order expired", async () => {
    const { app, rail, clock } = makeNearApp();
    const { merchant, order } = await seed(app, MERCHANT_NEAR, 30 * 60_000);
    const inst = await quote(app, order.id);
    clock.advance(31 * 60_000);
    rail.mock!.pay(inst.providerRef, "success");
    await app.payments.reconcileByPolling(inst.providerRef);
    expect((await app.repos.payments.byOrderId(order.id))!.status).toBe("expired");
    expect(await app.ledger.entries(merchant.id)).toHaveLength(0);
  });

  it("stays pending — and confirms nothing — when 1Click or NEAR cannot be reached", async () => {
    const { app, rail } = makeNearApp();
    const { order } = await seed(app);
    const inst = await quote(app, order.id);
    rail.mock!.pay(inst.providerRef, "success");
    rail.mock!.down = true;
    expect(await app.payments.reconcileByPolling(inst.providerRef)).toBe(false);
    expect((await app.repos.payments.byOrderId(order.id))!.status).toBe("pending");
    rail.mock!.down = false;
    expect(await app.payments.reconcileByPolling(inst.providerRef)).toBe(true);
  });

  it("the poller confirms a payment nobody is watching", async () => {
    const { app, rail, clock } = makeNearApp();
    const { order } = await seed(app);
    const inst = await quote(app, order.id);
    rail.mock!.pay(inst.providerRef, "success");
    const poller = new NearPaymentPoller(app.repos, app.payments, clock, 30);
    expect(await poller.tick()).toEqual({ checked: 1, confirmed: 1 });
    expect((await app.repos.orders.byId(order.id))!.status).toBe("paid");
    expect(await poller.tick()).toEqual({ checked: 0, confirmed: 0 });
  });
});

describe("reading USDC transfers off a NEAR transaction", () => {
  const usdc = "usdc.contract";
  const event = (to: string, amount: string) =>
    "EVENT_JSON:" +
    JSON.stringify({ standard: "nep141", event: "ft_transfer", data: [{ old_owner_id: "x", new_owner_id: to, amount }] });

  it("counts only events the token contract logged in receipts that succeeded", () => {
    const tx: NearTxResult = {
      receipts_outcome: [
        { id: "1", outcome: { executor_id: usdc, status: { SuccessValue: "" }, logs: [event("m.near", "100")] } },
        // Anyone can log this string from their own contract. It moves nothing.
        { id: "2", outcome: { executor_id: "forger.near", status: { SuccessValue: "" }, logs: [event("m.near", "999")] } },
        // A failed receipt's state change was rolled back.
        { id: "3", outcome: { executor_id: usdc, status: { Failure: {} }, logs: [event("m.near", "500")] } },
        { id: "4", outcome: { executor_id: usdc, status: { SuccessValue: "" }, logs: [event("m.near", "25"), "not json"] } },
      ],
    };
    expect(ftTransfersTo(tx, usdc).get("m.near")).toBe(125n);
  });
});

describe("rail registry", () => {
  it("routes a near_usdc merchant to NEAR Intents", () => {
    const { app } = makeNearApp();
    expect(app.rails.crypto("near_usdc").id).toBe("near_intents");
  });

  it("never registers a MOCK NEAR rail in production", () => {
    const { app } = makeNearApp();
    const registry = buildRegistry({
      ...app.config,
      NODE_ENV: "production",
      FEATURE_NEAR_ENABLED: true,
      NEAR_ADAPTER_MODE: "mock",
    });
    expect(registry.find("near_intents")).toBeNull();
  });
});

describe("NEAR checkout over HTTP", () => {
  let server: Server | undefined;
  afterAll(() => server?.close());

  it("offers the token picker, quotes on the buyer's choice, and flips to paid on a simulated deposit", async () => {
    const { app } = makeNearApp();
    const { order } = await seed(app);
    server = buildApi(app).listen(0);
    await new Promise((r) => server!.once("listening", r));
    const addr = server.address();
    const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    const json = async (path: string, body?: unknown) => {
      const res = await fetch(base + path, body
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : undefined);
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    };

    const checkout = await json(`/api/checkout/${order.id}`);
    expect(checkout.body.methods.cryptoKind).toBe("intents");

    const tokens = await json("/api/near/tokens");
    expect(tokens.body.tokens.map((t: { assetId: string }) => t.assetId)).toContain(USDT_TRON);

    const refused = await json(`/api/checkout/${order.id}/method`, { method: "crypto", originAsset: USDT_TRON });
    expect(refused.status).toBe(422);

    const picked = await json(`/api/checkout/${order.id}/method`, {
      method: "crypto",
      originAsset: USDT_TRON,
      refundTo: TRON_REFUND,
    });
    expect(picked.status).toBe(200);
    expect(picked.body.instruction.depositAddress).toMatch(/^mock-dep-/);

    expect((await json(`/api/checkout/${order.id}/near-status`)).body.phase).toBe("waiting");

    const sim = await json("/api/crypto/simulate-pay", { orderId: order.id });
    expect(sim.body.confirmed).toBe(true);
    expect((await json(`/api/checkout/${order.id}`)).body.order.status).toBe("paid");
    expect((await json(`/api/checkout/${order.id}/near-status`)).body.phase).toBe("paid");
  });
});
