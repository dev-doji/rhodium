import { describe, it, expect, afterAll } from "vitest";
import { makeApp, seedMerchant, seedProduct } from "./helpers/harness.js";
import { MonnifyFiatRail } from "../src/rails/monnify-fiat-rail.js";
import { AppError } from "../src/lib/errors.js";

// Run the harness with Monnify as the bank rail.
function monnifyApp() {
  process.env.FIAT_PROVIDER = "monnify";
  return makeApp();
}

afterAll(() => {
  delete process.env.FIAT_PROVIDER;
});

describe("Monnify bank rail (mock) — reserved account → transfer → ledger", () => {
  it("issues a reserved account and confirms a transfer into the naira ledger", async () => {
    const app = monnifyApp();
    expect(app.rails.fiat().id).toBe("monnify");
    const merchant = await seedMerchant(app);
    const product = await seedProduct(app, merchant.id, 500_000);
    const order = await app.commerce.createOrder({
      merchantId: merchant.id, buyerRef: "+2348090001234",
      lines: [{ productId: product.id, qty: 1 }], rail: "fiat",
    });
    const inst = await app.payments.requestPayment(order.id);
    expect(inst.accountNumber).toMatch(/^\d{10}$/);
    expect(inst.instructionType).toBe("dva");

    const rail = app.rails.fiat() as MonnifyFiatRail;
    const signed = rail.mock!.simulateTransfer(order.id);
    await app.payments.handleRailWebhook("monnify", {
      headers: { "monnify-signature": signed.signature },
      rawBody: signed.rawBody,
    });

    expect((await app.repos.orders.byId(order.id))!.status).toBe("paid");
    const entries = await app.ledger.entries(merchant.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.amount).toBe(500_000);
  });

  it("is idempotent on replayed webhook and rejects a bad signature", async () => {
    const app = monnifyApp();
    const merchant = await seedMerchant(app);
    const product = await seedProduct(app, merchant.id, 500_000);
    const order = await app.commerce.createOrder({
      merchantId: merchant.id, buyerRef: "+2348090001235",
      lines: [{ productId: product.id, qty: 1 }], rail: "fiat",
    });
    await app.payments.requestPayment(order.id);
    const rail = app.rails.fiat() as MonnifyFiatRail;
    const signed = rail.mock!.simulateTransfer(order.id);

    // forged signature rejected
    await expect(
      app.payments.handleRailWebhook("monnify", {
        headers: { "monnify-signature": "deadbeef" }, rawBody: signed.rawBody,
      }),
    ).rejects.toBeInstanceOf(AppError);

    // valid + replay → one entry
    await app.payments.handleRailWebhook("monnify", { headers: { "monnify-signature": signed.signature }, rawBody: signed.rawBody });
    const replay = rail.mock!.replayLastTransfer(order.id);
    await app.payments.handleRailWebhook("monnify", { headers: { "monnify-signature": replay.signature }, rawBody: replay.rawBody });
    expect(await app.ledger.entries(merchant.id)).toHaveLength(1);
  });
});
