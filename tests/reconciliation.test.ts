import { describe, it, expect } from "vitest";
import {
  makeApp,
  seedMerchant,
  seedProduct,
  orderWithDva,
  payWebhook,
} from "./helpers/harness.js";

describe("daily reconciliation — processor vs ledger drift detection", () => {
  it("reports CLEAN when confirmed payments match ledger entries", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    const product = await seedProduct(app, merchant.id, 500_000);
    for (let i = 0; i < 5; i++) {
      const { providerRef } = await orderWithDva(app, merchant.id, product.id, 1, `+2348012${i}`);
      await payWebhook(app, providerRef);
    }
    const report = await app.reconciliation.run();
    expect(report.clean).toBe(true);
    expect(report.drift).toHaveLength(0);
    expect(report.paymentsChecked).toBe(5);
  });

  it("detects a confirmed payment missing from the ledger", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    const product = await seedProduct(app, merchant.id, 500_000);
    const { providerRef } = await orderWithDva(app, merchant.id, product.id);
    const payment = await app.repos.payments.byProviderRef(providerRef);

    // Force drift: mark the payment confirmed WITHOUT appending to the ledger.
    await app.repos.payments.markConfirmed(payment!.id, new Date());

    const report = await app.reconciliation.run();
    expect(report.clean).toBe(false);
    expect(report.drift[0]!.kind).toBe("confirmed_not_in_ledger");
    expect(app.metrics.snapshot()["reconciliation_drift_alerts"]).toBe(1);
  });

  it("detects money the provider says is paid but we haven't confirmed", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    const product = await seedProduct(app, merchant.id, 500_000);
    const { providerRef } = await orderWithDva(app, merchant.id, product.id);

    // Provider received the transfer, but the webhook was lost.
    app.fiat.mock!.simulateTransfer(providerRef);

    const report = await app.reconciliation.run(); // pollProvider is on
    expect(report.clean).toBe(false);
    expect(report.drift.some((d) => d.kind === "provider_says_paid_we_dont")).toBe(true);
  });
});
