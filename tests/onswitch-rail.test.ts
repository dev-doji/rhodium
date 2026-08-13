import { describe, it, expect } from "vitest";
import { makeApp, seedMerchant, seedProduct } from "./helpers/harness.js";
import { OnSwitchRail } from "../src/rails/onswitch-rail.js";
import { AppError } from "../src/lib/errors.js";

function offrampOrder(app: ReturnType<typeof makeApp>, merchantId: string, productId: string) {
  return app.commerce.createOrder({
    merchantId, buyerRef: "+2348090007777",
    lines: [{ productId, qty: 1 }], rail: "crypto",
  });
}

describe("OnSwitch off-ramp — buyer pays stablecoin, merchant paid naira", () => {
  it("issues a deposit address and settles the sale into the naira ledger", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app); // has bank account
    const product = await seedProduct(app, merchant.id, 500_000);
    const order = await offrampOrder(app, merchant.id, product.id);

    const inst = await app.payments.requestPayment(order.id, "onswitch");
    expect(inst.instructionType).toBe("crypto");
    expect(inst.settlesToNaira).toBe(true);
    expect(inst.depositAddress).toMatch(/^0x[0-9a-f]{40}$/i);
    expect(Number(inst.cryptoAmount)).toBeGreaterThan(0);

    const rail = app.rails.get("onswitch") as OnSwitchRail;
    const signed = rail.mock!.complete(inst.providerRef);
    await app.payments.handleRailWebhook("onswitch", {
      headers: { "x-switch-signature": signed.signature },
      rawBody: signed.rawBody,
    });

    expect((await app.repos.orders.byId(order.id))!.status).toBe("paid");
    const entries = await app.ledger.entries(merchant.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.amount).toBe(500_000); // naira kobo — merchant credited in naira
  });

  it("refuses the off-ramp when the merchant has no bank account", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app, {
      settlementBankCode: undefined, settlementAccountNumber: undefined,
    });
    const product = await seedProduct(app, merchant.id, 500_000);
    const order = await offrampOrder(app, merchant.id, product.id);
    await expect(app.payments.requestPayment(order.id, "onswitch")).rejects.toBeInstanceOf(AppError);
  });

  it("rejects a forged webhook signature and is idempotent on replay", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    const product = await seedProduct(app, merchant.id, 500_000);
    const order = await offrampOrder(app, merchant.id, product.id);
    const inst = await app.payments.requestPayment(order.id, "onswitch");
    const rail = app.rails.get("onswitch") as OnSwitchRail;
    const signed = rail.mock!.complete(inst.providerRef);

    await expect(
      app.payments.handleRailWebhook("onswitch", {
        headers: { "x-switch-signature": "bad" }, rawBody: signed.rawBody,
      }),
    ).rejects.toBeInstanceOf(AppError);

    await app.payments.handleRailWebhook("onswitch", { headers: { "x-switch-signature": signed.signature }, rawBody: signed.rawBody });
    await app.payments.handleRailWebhook("onswitch", { headers: { "x-switch-signature": signed.signature }, rawBody: signed.rawBody });
    expect(await app.ledger.entries(merchant.id)).toHaveLength(1);
  });
});
