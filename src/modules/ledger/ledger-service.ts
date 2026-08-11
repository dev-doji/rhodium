import type { Repositories } from "../../db/repositories.js";
import type { LedgerEntry } from "../../domain/types.js";
import type { Kobo } from "../../lib/money.js";

/**
 * Ledger Service (§2.1) — the records value + the data asset. Append-only:
 * every confirmed payment produces exactly one entry with a running balance.
 * There is deliberately no update/delete surface here.
 */
export class LedgerService {
  constructor(private repos: Repositories) {}

  async recordSale(input: {
    merchantId: string;
    orderId: string;
    paymentId: string;
    amount: Kobo;
  }): Promise<LedgerEntry> {
    return this.repos.ledger.append({
      merchantId: input.merchantId,
      orderId: input.orderId,
      paymentId: input.paymentId,
      type: "sale",
      amount: input.amount, // positive
    });
  }

  balance(merchantId: string): Promise<Kobo> {
    return this.repos.ledger.balance(merchantId);
  }

  entries(merchantId: string): Promise<LedgerEntry[]> {
    return this.repos.ledger.listByMerchant(merchantId);
  }

  async weeklySummary(
    merchantId: string,
    since: Date,
  ): Promise<{ count: number; total: Kobo }> {
    const entries = await this.repos.ledger.listByMerchant(merchantId);
    const window = entries.filter(
      (e) => e.type === "sale" && e.createdAt >= since,
    );
    return {
      count: window.length,
      total: window.reduce((acc, e) => acc + e.amount, 0),
    };
  }
}
