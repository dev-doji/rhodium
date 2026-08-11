import type { Repositories } from "../../db/repositories.js";
import { formatNaira, type Kobo } from "../../lib/money.js";

export interface TractionSnapshot {
  gmvKobo: Kobo;
  gmvFormatted: string;
  salesCount: number;
  uniqueBuyers: number;
  merchantsTransacting: number;
  railSplit: { fiat: number; crypto: number };
  recent: {
    orderId: string;
    rail: string;
    amountFormatted: string;
    at: string;
  }[];
}

/**
 * Traction — the hackathon's graded metric. Purchase/sales traction across the
 * platform, computed from confirmed payments + the append-only ledger. Split by
 * rail so bank-transfer and crypto (Quai/BlipPay) sales are both visible.
 */
export class TractionService {
  constructor(private repos: Repositories) {}

  async snapshot(limit = 15): Promise<TractionSnapshot> {
    const payments = await this.repos.payments.all();
    const confirmed = payments.filter((p) => p.status === "confirmed");

    let gmv = 0;
    const buyers = new Set<string>();
    const merchants = new Set<string>();
    const railSplit = { fiat: 0, crypto: 0 };
    const recent: TractionSnapshot["recent"] = [];

    for (const p of confirmed) {
      const order = await this.repos.orders.byId(p.orderId);
      if (!order) continue;
      gmv += p.amount;
      buyers.add(`${order.merchantId}:${order.buyerRef}`);
      merchants.add(order.merchantId);
      if (order.rail === "crypto") railSplit.crypto += 1;
      else railSplit.fiat += 1;
      recent.push({
        orderId: order.id,
        rail: order.rail,
        amountFormatted: formatNaira(p.amount),
        at: (p.confirmedAt ?? p.createdAt).toISOString(),
      });
    }
    recent.sort((a, b) => b.at.localeCompare(a.at));

    return {
      gmvKobo: gmv,
      gmvFormatted: formatNaira(gmv),
      salesCount: confirmed.length,
      uniqueBuyers: buyers.size,
      merchantsTransacting: merchants.size,
      railSplit,
      recent: recent.slice(0, limit),
    };
  }
}
