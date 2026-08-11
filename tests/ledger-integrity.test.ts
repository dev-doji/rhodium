import { describe, it, expect } from "vitest";
import {
  makeApp,
  seedMerchant,
  seedProduct,
  orderWithDva,
  payWebhook,
} from "./helpers/harness.js";

describe("ledger integrity — zero lost/double-counted payments (§1.6)", () => {
  it("50+ transactions produce 50+ entries, exact running balance, no double-count", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    const product = await seedProduct(app, merchant.id, 100_000); // ₦1,000

    const N = 60;
    let expectedBalance = 0;
    for (let i = 0; i < N; i++) {
      const { providerRef } = await orderWithDva(
        app,
        merchant.id,
        product.id,
        1,
        `+23480900000${i.toString().padStart(2, "0")}`,
      );
      await payWebhook(app, providerRef);
      expectedBalance += 100_000;
    }

    const entries = await app.ledger.entries(merchant.id);
    expect(entries).toHaveLength(N);
    expect(await app.ledger.balance(merchant.id)).toBe(expectedBalance);

    // Running balance is monotonic and consistent entry-to-entry.
    let prev = 0;
    for (const e of entries) {
      expect(e.balanceAfter).toBe(prev + e.amount);
      prev = e.balanceAfter;
    }
    expect(prev).toBe(expectedBalance);
  });

  it("concurrent confirmations never race the running balance", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    const product = await seedProduct(app, merchant.id, 250_000);

    const refs: string[] = [];
    for (let i = 0; i < 25; i++) {
      const { providerRef } = await orderWithDva(
        app,
        merchant.id,
        product.id,
        1,
        `+2348011${i.toString().padStart(4, "0")}`,
      );
      refs.push(providerRef);
    }

    // Fire all confirmations concurrently.
    await Promise.all(refs.map((r) => payWebhook(app, r)));

    const entries = await app.ledger.entries(merchant.id);
    expect(entries).toHaveLength(25);
    expect(await app.ledger.balance(merchant.id)).toBe(25 * 250_000);

    const balances = entries.map((e) => e.balanceAfter).sort((a, b) => a - b);
    // Every step of 250_000 appears exactly once — no duplicated balances.
    for (let i = 0; i < balances.length; i++) {
      expect(balances[i]).toBe((i + 1) * 250_000);
    }
  });
});
