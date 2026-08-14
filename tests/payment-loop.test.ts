import { describe, it, expect } from "vitest";
import {
  makeApp,
  seedMerchant,
  seedProduct,
  orderWithDva,
  payWebhook,
  replayWebhook,
} from "./helpers/harness.js";
import { ValidationError } from "../src/lib/errors.js";

describe("the magic moment — sell → pay → confirm → receipt → ledger", () => {
  it("confirms an order end-to-end and appends exactly one ledger entry", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    const product = await seedProduct(app, merchant.id, 500_000);
    const { order, providerRef } = await orderWithDva(app, merchant.id, product.id);

    await payWebhook(app, providerRef);

    const finalOrder = await app.repos.orders.byId(order.id);
    const payment = await app.repos.payments.byOrderId(order.id);
    const entries = await app.ledger.entries(merchant.id);

    expect(finalOrder!.status).toBe("paid");
    expect(payment!.status).toBe("confirmed");
    expect(payment!.confirmedAt).toBeInstanceOf(Date);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.amount).toBe(500_000);
    expect(entries[0]!.balanceAfter).toBe(500_000);
    expect(await app.ledger.balance(merchant.id)).toBe(500_000);

    // Merchant confirmation + buyer receipt were sent. Assert on who was told
    // and the amount — not the wording, which is copy and gets reworded.
    const sent = app.channel.sent;
    const toMerchant = sent.find((s) => s.to === merchant.phone);
    expect(toMerchant?.message).toContain("₦5,000.00");
    const bodies = sent.map((s) => s.message).join("\n");
    expect(bodies).toContain("Receipt from");
  });

  it("is idempotent: a replayed webhook does NOT double-count", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    const product = await seedProduct(app, merchant.id, 500_000);
    const { providerRef } = await orderWithDva(app, merchant.id, product.id);

    await payWebhook(app, providerRef);
    await replayWebhook(app, providerRef); // duplicate delivery
    await replayWebhook(app, providerRef); // and again

    const entries = await app.ledger.entries(merchant.id);
    expect(entries).toHaveLength(1);
    expect(await app.ledger.balance(merchant.id)).toBe(500_000);
    expect(app.metrics.snapshot()["webhook_duplicate"]).toBeGreaterThanOrEqual(1);
  });

  it("rejects a webhook with a forged signature", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    const product = await seedProduct(app, merchant.id);
    const { providerRef } = await orderWithDva(app, merchant.id, product.id);
    const signed = app.fiat.mock!.simulateTransfer(providerRef);

    await expect(
      app.payments.handleRailWebhook("monnify", {
        headers: { "monnify-signature": "deadbeef" },
        rawBody: signed.rawBody,
      }),
    ).rejects.toThrow(/signature/);

    expect(await app.ledger.entries(merchant.id)).toHaveLength(0);
  });

  it("flags an amount mismatch and does not confirm", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    const product = await seedProduct(app, merchant.id, 500_000);
    const { order, providerRef } = await orderWithDva(app, merchant.id, product.id);

    await expect(payWebhook(app, providerRef, 400_000)).rejects.toBeInstanceOf(
      ValidationError,
    );

    const finalOrder = await app.repos.orders.byId(order.id);
    expect(finalOrder!.status).toBe("awaiting_payment");
    expect(await app.ledger.entries(merchant.id)).toHaveLength(0);
    expect(app.metrics.snapshot()["payment_amount_mismatch"]).toBe(1);
  });

  it("poll fallback confirms a payment whose webhook never arrived", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    const product = await seedProduct(app, merchant.id, 500_000);
    const { order, providerRef } = await orderWithDva(app, merchant.id, product.id);

    // Simulate money landing at the provider without delivering the webhook.
    app.fiat.mock!.simulateTransfer(providerRef);

    const confirmed = await app.payments.reconcileByPolling(providerRef);
    expect(confirmed).toBe(true);
    expect((await app.repos.orders.byId(order.id))!.status).toBe("paid");
    expect(await app.ledger.entries(merchant.id)).toHaveLength(1);
  });

  it("issues one DVA per order and re-requesting is idempotent", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    const product = await seedProduct(app, merchant.id);
    const order = await app.commerce.createOrder({
      merchantId: merchant.id,
      buyerRef: "+2348090000009",
      lines: [{ productId: product.id, qty: 1 }],
    });
    const first = await app.payments.requestPayment(order.id);
    const second = await app.payments.requestPayment(order.id);
    expect(second.providerRef).toBe(first.providerRef);
    const payments = await app.repos.payments.all();
    expect(payments).toHaveLength(1);
  });

  it("decrements stock on a confirmed sale", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    const product = await seedProduct(app, merchant.id, 500_000, 10);
    const { providerRef } = await orderWithDva(app, merchant.id, product.id, 3);
    await payWebhook(app, providerRef);
    const after = await app.repos.products.byId(product.id);
    expect(after!.stockQty).toBe(7);
  });
});
