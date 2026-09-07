import type { Repositories } from "../../db/repositories.js";
import type { Clock } from "../../lib/clock.js";
import { formatNaira, type Kobo } from "../../lib/money.js";
import { computeFees, paystackFee } from "../fees/fee-schedule.js";

export interface RailVolume {
  /** Number of confirmed sales on this rail. */
  count: number;
  amountKobo: Kobo;
  amountFormatted: string;
}

export interface AdminOverview {
  generatedAt: string;
  merchants: {
    total: number;
    newLast7d: number;
    newLast30d: number;
    /**
     * Merchants who could actually take money: a payout subaccount exists.
     * Distinct from `total`, because signing up and being able to sell are
     * different things — this gap is where onboarding quietly fails.
     */
    readyToSell: number;
    /** Merchants with at least one confirmed sale. */
    transacting: number;
    byStatus: Record<string, number>;
  };
  volume: {
    grossKobo: Kobo;
    grossFormatted: string;
    salesCount: number;
    uniqueBuyers: number;
    /** Volume by rail, in money — not a count of orders. */
    byRail: { fiat: RailVolume; crypto: RailVolume };
  };
  /**
   * What the current fee schedule WOULD have earned on the sales below.
   *
   * Projected, not collected. The fee engine is not yet applied to live orders,
   * so no buyer has been charged a platform fee and no merchant has had one
   * deducted. Presenting this as revenue would be inventing income.
   */
  projectedFees: {
    platformKobo: Kobo;
    platformFormatted: string;
    buyerShareKobo: Kobo;
    merchantShareKobo: Kobo;
    /** What Paystack took on the same sales, for comparison. */
    processorKobo: Kobo;
    processorFormatted: string;
  };
  recent: {
    orderId: string;
    merchantId: string;
    businessName: string;
    rail: string;
    amountFormatted: string;
    at: string;
  }[];
}

/**
 * The numbers behind the admin dashboard.
 *
 * Deliberately separate from TractionService, which answers a different
 * question — TractionService was written for hackathon judging, is served
 * unauthenticated, and counts rails rather than measuring them.
 */
export class AdminMetricsService {
  constructor(
    private repos: Repositories,
    private clock: Clock,
  ) {}

  async overview(recentLimit = 20): Promise<AdminOverview> {
    const now = this.clock.now();
    const since = (days: number) => new Date(now.getTime() - days * 86_400_000);
    const last7 = since(7);
    const last30 = since(30);

    const merchants = await this.repos.merchants.list();
    const byStatus: Record<string, number> = {};
    let newLast7d = 0;
    let newLast30d = 0;
    let readyToSell = 0;
    const nameById = new Map<string, string>();

    for (const m of merchants) {
      byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
      if (m.createdAt >= last7) newLast7d++;
      if (m.createdAt >= last30) newLast30d++;
      if (m.processorSubaccountCode) readyToSell++;
      nameById.set(m.id, m.businessName);
    }

    const payments = await this.repos.payments.all();
    const confirmed = payments.filter((p) => p.status === "confirmed");

    let gross = 0;
    let platformFees = 0;
    let buyerShare = 0;
    let merchantShare = 0;
    let processor = 0;
    const buyers = new Set<string>();
    const transacting = new Set<string>();
    const byRail = {
      fiat: { count: 0, amountKobo: 0, amountFormatted: "" },
      crypto: { count: 0, amountKobo: 0, amountFormatted: "" },
    };
    const recent: AdminOverview["recent"] = [];

    for (const p of confirmed) {
      const order = await this.repos.orders.byId(p.orderId);
      // A payment whose order is gone is a data problem, not a sale: counting
      // it would inflate volume with money that cannot be attributed to anyone.
      if (!order) continue;

      gross += p.amount;
      buyers.add(`${order.merchantId}:${order.buyerRef}`);
      transacting.add(order.merchantId);

      const lane = order.rail === "crypto" ? byRail.crypto : byRail.fiat;
      lane.count++;
      lane.amountKobo += p.amount;

      // Computed from the ORDER's listed amount, which is what a merchant typed
      // and what the schedule takes its percentage of.
      const fee = computeFees(order.amount);
      platformFees += fee.platformFee;
      buyerShare += fee.buyerShare;
      merchantShare += fee.merchantShare;
      processor += paystackFee(p.amount);

      recent.push({
        orderId: order.id,
        merchantId: order.merchantId,
        businessName: nameById.get(order.merchantId) ?? "(unknown)",
        rail: order.rail,
        amountFormatted: formatNaira(p.amount),
        at: (p.confirmedAt ?? p.createdAt).toISOString(),
      });
    }

    byRail.fiat.amountFormatted = formatNaira(byRail.fiat.amountKobo);
    byRail.crypto.amountFormatted = formatNaira(byRail.crypto.amountKobo);
    recent.sort((a, b) => b.at.localeCompare(a.at));

    return {
      generatedAt: now.toISOString(),
      merchants: {
        total: merchants.length,
        newLast7d,
        newLast30d,
        readyToSell,
        transacting: transacting.size,
        byStatus,
      },
      volume: {
        grossKobo: gross,
        grossFormatted: formatNaira(gross),
        salesCount: confirmed.length,
        uniqueBuyers: buyers.size,
        byRail,
      },
      projectedFees: {
        platformKobo: platformFees,
        platformFormatted: formatNaira(platformFees),
        buyerShareKobo: buyerShare,
        merchantShareKobo: merchantShare,
        processorKobo: processor,
        processorFormatted: formatNaira(processor),
      },
      recent: recent.slice(0, recentLimit),
    };
  }
}
