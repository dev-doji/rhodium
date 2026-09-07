import { describe, it, expect } from "vitest";
import { AdminViews } from "../src/modules/admin/admin-metrics.js";
import { FixedClock } from "../src/lib/clock.js";
import {
  makeApp,
  seedMerchant,
  seedProduct,
  orderWithDva,
  payWebhook,
} from "./helpers/harness.js";

const NOW = new Date("2026-09-07T12:00:00Z");

function views(app: ReturnType<typeof makeApp>) {
  return new AdminViews(app.repos, new FixedClock(NOW));
}

describe("the merchants page", () => {
  it("separates onboarded from able-to-be-paid", async () => {
    // The distinction the whole page exists for. A merchant with a bank account
    // but no processor subaccount looks fine in a list of merchants and cannot
    // take a single naira — that is exactly how Tees Kitchen's first sale
    // failed with "merchant is not set up to receive payments yet".
    const app = makeApp();
    const ready = await seedMerchant(app);
    await app.repos.merchants.update(ready.id, { processorSubaccountCode: "ACCT_live" });
    await seedMerchant(app, { phone: "+2348079999999", businessName: "No Payout" });

    const rows = await views(app).merchants();
    const byName = new Map(rows.map((r) => [r.businessName, r]));

    expect(rows).toHaveLength(2);
    expect(byName.get("No Payout")!.payoutReady).toBe(false);
    expect(rows.find((r) => r.id === ready.id)!.payoutReady).toBe(true);
  });

  it("counts only confirmed sales in a merchant's volume", async () => {
    // An unpaid order is not revenue. Counting it would tell the operator a
    // merchant is trading when nobody has sent her anything.
    const app = makeApp();
    const m = await seedMerchant(app);
    const product = await seedProduct(app, m.id, 250_000);
    const { providerRef } = await orderWithDva(app, m.id, product.id, 1, "+2348011111111");
    await orderWithDva(app, m.id, product.id, 1, "+2348022222222"); // left unpaid
    await payWebhook(app, providerRef);

    const row = (await views(app).merchants()).find((r) => r.id === m.id)!;
    expect(row.salesCount).toBe(1);
    expect(row.volumeKobo).toBe(250_000);
  });
});

describe("a rail's own page", () => {
  it("reports fiat volume as money, not a count of orders", async () => {
    // The gap that prompted this: the old traction page said "fiat: 1", which
    // is one order, not one naira.
    const app = makeApp();
    const m = await seedMerchant(app);
    const product = await seedProduct(app, m.id, 150_000);
    for (const phone of ["+2348031111111", "+2348032222222"]) {
      const { providerRef } = await orderWithDva(app, m.id, product.id, 1, phone);
      await payWebhook(app, providerRef);
    }

    const fiat = await views(app).rail("fiat");
    expect(fiat.salesCount).toBe(2);
    expect(fiat.volumeKobo).toBe(300_000);
    expect(fiat.averageKobo).toBe(150_000);
    expect(fiat.merchantsSelling).toBe(1);
  });

  it("shows payments that never completed, not only the wins", async () => {
    const app = makeApp();
    const m = await seedMerchant(app);
    const product = await seedProduct(app, m.id, 100_000);
    const { providerRef } = await orderWithDva(app, m.id, product.id, 1, "+2348041111111");
    await orderWithDva(app, m.id, product.id, 1, "+2348042222222"); // stays pending
    await payWebhook(app, providerRef);

    const fiat = await views(app).rail("fiat");
    expect(fiat.byStatus.confirmed).toBe(1);
    expect(fiat.byStatus.pending).toBe(1);
    // ...but only the confirmed one is money.
    expect(fiat.volumeKobo).toBe(100_000);
  });

  it("says plainly when a rail has never carried a payment", async () => {
    // Rather than a page of zeroes that reads like a bug.
    const app = makeApp();
    const crypto = await views(app).rail("crypto");
    expect(crypto.salesCount).toBe(0);
    expect(crypto.note).toMatch(/no real usdc/i);
  });

  it("keeps the two rails apart", async () => {
    const app = makeApp();
    const m = await seedMerchant(app);
    const product = await seedProduct(app, m.id, 500_000);
    const { providerRef } = await orderWithDva(app, m.id, product.id, 1, "+2348051111111");
    await payWebhook(app, providerRef);

    expect((await views(app).rail("fiat")).volumeKobo).toBe(500_000);
    expect((await views(app).rail("crypto")).volumeKobo).toBe(0);
  });
});

describe("the issues page", () => {
  it("flags an active merchant who cannot be paid", async () => {
    const app = makeApp();
    const m = await seedMerchant(app, { businessName: "Stuck Shop" });
    await app.repos.merchants.update(m.id, {
      settlementAccountNumber: "0123456789",
      settlementBankCode: "999992",
    });

    const report = await views(app).issues();
    const issue = report.issues.find((i) => i.kind === "no_subaccount");
    expect(issue, JSON.stringify(report.totals)).toBeDefined();
    expect(issue!.severity).toBe("blocking");
    expect(issue!.detail).toContain("Stuck Shop");
    // The point of the page: it says what to do, not just what is wrong.
    expect(issue!.action.length).toBeGreaterThan(10);
  });

  it("distinguishes no bank account at all from no subaccount", async () => {
    // Different causes, different fixes: one is unfinished onboarding, the
    // other is a backfill or a bank code Paystack rejects.
    const app = makeApp();
    // seedMerchant fills in a bank account by default, so it has to be cleared
    // explicitly to model a merchant who never finished onboarding.
    await seedMerchant(app, {
      businessName: "Never Finished",
      settlementAccountNumber: undefined,
      settlementBankCode: undefined,
    });

    const report = await views(app).issues();
    expect(report.totals.no_bank_account).toBe(1);
    expect(report.totals.no_subaccount).toBeUndefined();
  });

  it("says nothing when a properly set-up merchant has sold", async () => {
    // The all-clear has to be reachable, or the page becomes noise people
    // learn to ignore.
    const app = makeApp();
    const m = await seedMerchant(app);
    await app.repos.merchants.update(m.id, {
      settlementAccountNumber: "0123456789",
      processorSubaccountCode: "ACCT_ok",
    });
    const product = await seedProduct(app, m.id, 100_000);
    const { providerRef } = await orderWithDva(app, m.id, product.id, 1, "+2348061111111");
    await payWebhook(app, providerRef);

    const report = await views(app).issues();
    expect(report.total, JSON.stringify(report.totals)).toBe(0);
    expect(report.issues).toEqual([]);
  });

  it("puts blocking problems above warnings", async () => {
    const app = makeApp();
    // Blocking: active, no bank account.
    await seedMerchant(app, { businessName: "Blocked", settlementAccountNumber: undefined });
    // Warning: wants USDC, has no wallet.
    const crypto = await seedMerchant(app, { phone: "+2348071111111", businessName: "Wants USDC" });
    await app.repos.merchants.update(crypto.id, {
      settlementAccountNumber: "0123456789",
      processorSubaccountCode: "ACCT_ok",
      cryptoEnabled: true,
      cryptoSettlement: "usdc",
    });

    const report = await views(app).issues();
    expect(report.issues[0]!.severity).toBe("blocking");
    expect(report.issues.at(-1)!.severity).toBe("warning");
    expect(report.blocking).toBe(1);
  });

  it("caps the list but still counts everything", async () => {
    // A hundred merchants missing the same subaccount is one problem to fix
    // once. The list is for reading; the totals carry the real scale.
    const app = makeApp();
    for (let i = 0; i < 60; i++) {
      await seedMerchant(app, {
        phone: `+23480900000${String(i).padStart(2, "0")}`,
        businessName: `Shop ${i}`,
        settlementAccountNumber: undefined,
      });
    }

    const report = await views(app).issues();
    expect(report.total).toBe(60);
    expect(report.issues.length).toBe(50);
    expect(report.omitted).toBe(10);
    expect(report.totals.no_bank_account).toBe(60);
  });
});
