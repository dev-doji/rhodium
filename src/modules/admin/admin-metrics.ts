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

    // One query for all of them. This was one per payment, on a page that
    // walks every payment ever taken.
    const ordersById = new Map(
      (await this.repos.orders.byIds(confirmed.map((p) => p.orderId))).map((o) => [o.id, o]),
    );

    for (const p of confirmed) {
      const order = ordersById.get(p.orderId);
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

// ---------------------------------------------------------------------------
// The per-surface views behind the admin dashboard's Fiat, Crypto, Merchants
// and Issues pages.
// ---------------------------------------------------------------------------

export interface MerchantRow {
  id: string;
  businessName: string;
  status: string;
  kycState: string;
  joined: string;
  slug?: string;
  /** Can she actually be paid? A subaccount is what routes money to her bank. */
  payoutReady: boolean;
  hasBankAccount: boolean;
  cryptoEnabled: boolean;
  cryptoSettlement?: string;
  hasWallet: boolean;
  salesCount: number;
  volumeKobo: Kobo;
  volumeFormatted: string;
}

export interface RailReport {
  rail: "fiat" | "crypto";
  volumeKobo: Kobo;
  volumeFormatted: string;
  salesCount: number;
  uniqueBuyers: number;
  merchantsSelling: number;
  averageKobo: Kobo;
  averageFormatted: string;
  /** Payment rows by status, so pending and failed are visible, not just wins. */
  byStatus: Record<string, number>;
  /** How the buyer was asked to pay: a virtual account, a link, or on-chain. */
  byInstruction: Record<string, number>;
  /** Which processor actually carried it. */
  byProvider: Record<string, number>;
  topMerchants: { merchantId: string; businessName: string; salesCount: number; volumeFormatted: string }[];
  recent: {
    orderId: string;
    businessName: string;
    amountFormatted: string;
    status: string;
    at: string;
  }[];
  /** Said plainly when a rail has never carried a real payment. */
  note?: string;
}

export type IssueSeverity = "blocking" | "warning";

export interface Issue {
  severity: IssueSeverity;
  kind: string;
  title: string;
  /** What is wrong, in one sentence someone can act on. */
  detail: string;
  /** What to do about it. */
  action: string;
  subject?: { merchantId?: string; businessName?: string; orderId?: string };
}

/** An order older than this with nobody having paid is not "in progress". */
const STALE_ORDER_MS = 48 * 60 * 60_000;

/**
 * Most cards to return.
 *
 * A hundred merchants with the same missing subaccount is one problem, not a
 * hundred — and a page of four hundred identical cards is a page nobody reads.
 * The per-kind totals carry the real scale; the list carries the detail.
 */
const MAX_ISSUES = 50;

export interface IssueReport {
  issues: Issue[];
  /** How many of each kind exist, including any not listed. */
  totals: Record<string, number>;
  total: number;
  blocking: number;
  /** How many were left out of `issues` by the cap. */
  omitted: number;
}

export class AdminViews {
  constructor(
    private repos: Repositories,
    private clock: Clock,
  ) {}

  /** Every merchant, with the two facts that decide whether she can trade. */
  async merchants(): Promise<MerchantRow[]> {
    const merchants = await this.repos.merchants.list();
    const { countByMerchant, volumeByMerchant } = await this.salesByMerchant();

    return merchants
      .map((m) => ({
        id: m.id,
        businessName: m.businessName,
        status: m.status,
        kycState: m.kycState,
        joined: m.createdAt.toISOString(),
        ...(m.slug ? { slug: m.slug } : {}),
        payoutReady: Boolean(m.processorSubaccountCode),
        hasBankAccount: Boolean(m.settlementAccountNumber),
        cryptoEnabled: m.cryptoEnabled,
        ...(m.cryptoSettlement ? { cryptoSettlement: m.cryptoSettlement } : {}),
        hasWallet: Boolean(m.quaiAddress),
        salesCount: countByMerchant.get(m.id) ?? 0,
        volumeKobo: volumeByMerchant.get(m.id) ?? 0,
        volumeFormatted: formatNaira(volumeByMerchant.get(m.id) ?? 0),
      }))
      .sort((a, b) => b.joined.localeCompare(a.joined));
  }

  /** One rail, measured rather than counted. */
  async rail(which: "fiat" | "crypto", recentLimit = 25): Promise<RailReport> {
    const merchants = await this.repos.merchants.list();
    const nameById = new Map(merchants.map((m) => [m.id, m.businessName]));
    const payments = await this.repos.payments.all();

    let volume = 0;
    let confirmedCount = 0;
    const buyers = new Set<string>();
    const sellers = new Set<string>();
    const byStatus: Record<string, number> = {};
    const byInstruction: Record<string, number> = {};
    const byProvider: Record<string, number> = {};
    const perMerchant = new Map<string, { count: number; volume: Kobo }>();
    const recent: RailReport["recent"] = [];

    const ordersById = new Map(
      (await this.repos.orders.byIds(payments.map((p) => p.orderId))).map((o) => [o.id, o]),
    );

    for (const p of payments) {
      const order = ordersById.get(p.orderId);
      if (!order || order.rail !== which) continue;

      // Every payment on this rail counts towards the status mix — a rail whose
      // failures are invisible looks healthier than it is.
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
      byInstruction[p.instructionType] = (byInstruction[p.instructionType] ?? 0) + 1;
      byProvider[p.railId] = (byProvider[p.railId] ?? 0) + 1;

      recent.push({
        orderId: order.id,
        businessName: nameById.get(order.merchantId) ?? "(unknown)",
        amountFormatted: formatNaira(p.amount),
        status: p.status,
        at: (p.confirmedAt ?? p.createdAt).toISOString(),
      });

      // Only confirmed money is volume. Counting pending would report as
      // revenue an amount nobody has actually sent.
      if (p.status !== "confirmed") continue;
      volume += p.amount;
      confirmedCount++;
      buyers.add(`${order.merchantId}:${order.buyerRef}`);
      sellers.add(order.merchantId);
      const row = perMerchant.get(order.merchantId) ?? { count: 0, volume: 0 };
      row.count++;
      row.volume += p.amount;
      perMerchant.set(order.merchantId, row);
    }

    recent.sort((a, b) => b.at.localeCompare(a.at));

    const topMerchants = [...perMerchant.entries()]
      .sort(([, a], [, b]) => b.volume - a.volume)
      .slice(0, 10)
      .map(([merchantId, row]) => ({
        merchantId,
        businessName: nameById.get(merchantId) ?? "(unknown)",
        salesCount: row.count,
        volumeFormatted: formatNaira(row.volume),
      }));

    const average = confirmedCount ? Math.round(volume / confirmedCount) : 0;

    const report: RailReport = {
      rail: which,
      volumeKobo: volume,
      volumeFormatted: formatNaira(volume),
      salesCount: confirmedCount,
      uniqueBuyers: buyers.size,
      merchantsSelling: sellers.size,
      averageKobo: average,
      averageFormatted: formatNaira(average),
      byStatus,
      byInstruction,
      byProvider,
      topMerchants,
      recent: recent.slice(0, recentLimit),
    };

    if (confirmedCount === 0) {
      report.note =
        which === "crypto"
          ? "No crypto payment has ever settled. The rail is wired and tested, but no real USDC has moved through it."
          : "No bank transfer has settled yet.";
    }
    return report;
  }

  /**
   * Things that need a person.
   *
   * Built from the database alone — no provider calls — so opening this page
   * costs nothing and cannot be slowed down by Paystack having a bad minute.
   * The nightly reconciliation job still does the deeper provider comparison.
   */
  async issues(): Promise<IssueReport> {
    const now = this.clock.now();
    const issues: Issue[] = [];
    const merchants = await this.repos.merchants.list();
    const nameById = new Map(merchants.map((m) => [m.id, m.businessName]));

    for (const m of merchants) {
      if (m.status !== "active") continue;

      if (!m.settlementAccountNumber) {
        issues.push({
          severity: "blocking",
          kind: "no_bank_account",
          title: "No payout account",
          detail: `${m.businessName} is active but has given no bank account, so a buyer cannot pay her at all.`,
          action: "Ask her to finish onboarding on WhatsApp and add her account number.",
          subject: { merchantId: m.id, businessName: m.businessName },
        });
        continue;
      }

      if (!m.processorSubaccountCode) {
        // This is the exact failure a buyer sees as "merchant is not set up to
        // receive payments yet" — worth naming plainly rather than as a code.
        issues.push({
          severity: "blocking",
          kind: "no_subaccount",
          title: "Cannot receive money",
          detail:
            `${m.businessName} has a bank account on file but no processor subaccount, ` +
            "so checkout refuses her orders.",
          action: "Re-run the payout-account backfill, or check the bank code is one Paystack accepts.",
          subject: { merchantId: m.id, businessName: m.businessName },
        });
      }

      if (m.cryptoEnabled && m.cryptoSettlement === "usdc" && !m.quaiAddress) {
        issues.push({
          severity: "warning",
          kind: "no_wallet",
          title: "Chose USDC, has no wallet",
          detail: `${m.businessName} asked to be settled in USDC but has no wallet address on file.`,
          action: "Have her back up a wallet from the dashboard, or switch her settlement to naira.",
          subject: { merchantId: m.id, businessName: m.businessName },
        });
      }
    }

    const payments = await this.repos.payments.all();
    const orderById = new Map(
      (await this.repos.orders.byIds(payments.map((p) => p.orderId))).map((o) => [o.id, o]),
    );
    for (const p of payments) {
      const order = orderById.get(p.orderId);
      if (!order) {
        issues.push({
          severity: "warning",
          kind: "orphan_payment",
          title: "Payment with no order",
          detail: `Payment ${p.id} points at order ${p.orderId}, which does not exist.`,
          action: "Investigate before it reaches a reconciliation report as drift.",
          subject: { orderId: p.orderId },
        });
        continue;
      }

      // Money confirmed but nothing in the ledger is the one that matters: the
      // merchant has been paid and her statement does not say so.
      if (p.status === "confirmed") {
        const entries = await this.repos.ledger.listByMerchant(order.merchantId);
        const booked = entries.some((e) => e.orderId === order.id);
        if (!booked) {
          issues.push({
            severity: "blocking",
            kind: "confirmed_not_in_ledger",
            title: "Paid but not in the ledger",
            detail:
              `Order ${order.id} for ${nameById.get(order.merchantId) ?? "a merchant"} is confirmed ` +
              `at ${formatNaira(p.amount)}, but no ledger entry records it.`,
            action: "Run reconciliation. Her balance and statement are understated until this is booked.",
            subject: { merchantId: order.merchantId, orderId: order.id },
          });
        }
        continue;
      }

      if (p.status === "pending" && now.getTime() - order.createdAt.getTime() > STALE_ORDER_MS) {
        issues.push({
          severity: "warning",
          kind: "stale_order",
          title: "Order never paid",
          detail:
            `Order ${order.id} has been awaiting payment since ` +
            `${order.createdAt.toISOString().slice(0, 10)} — the buyer never sent the money.`,
          action: "Usually an abandoned cart. Worth checking only if there are many at once.",
          subject: { merchantId: order.merchantId, orderId: order.id },
        });
      }
    }

    // Blocking first: this page is read top-down when something is wrong.
    const rank = (i: Issue) => (i.severity === "blocking" ? 0 : 1);
    issues.sort((a, b) => rank(a) - rank(b));

    const totals: Record<string, number> = {};
    for (const i of issues) totals[i.kind] = (totals[i.kind] ?? 0) + 1;

    return {
      issues: issues.slice(0, MAX_ISSUES),
      totals,
      total: issues.length,
      blocking: issues.filter((i) => i.severity === "blocking").length,
      omitted: Math.max(0, issues.length - MAX_ISSUES),
    };
  }

  private async salesByMerchant(): Promise<{
    countByMerchant: Map<string, number>;
    volumeByMerchant: Map<string, Kobo>;
  }> {
    const countByMerchant = new Map<string, number>();
    const volumeByMerchant = new Map<string, Kobo>();
    const confirmed = (await this.repos.payments.all()).filter((p) => p.status === "confirmed");
    const orderById = new Map(
      (await this.repos.orders.byIds(confirmed.map((p) => p.orderId))).map((o) => [o.id, o]),
    );
    for (const p of confirmed) {
      const order = orderById.get(p.orderId);
      if (!order) continue;
      countByMerchant.set(order.merchantId, (countByMerchant.get(order.merchantId) ?? 0) + 1);
      volumeByMerchant.set(order.merchantId, (volumeByMerchant.get(order.merchantId) ?? 0) + p.amount);
    }
    return { countByMerchant, volumeByMerchant };
  }
}
