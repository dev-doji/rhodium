import type { Kobo } from "../../lib/money.js";

/**
 * What Rhodium charges on a completed sale, and who pays it.
 *
 * Everything here is in KOBO and integer arithmetic throughout. A fee computed
 * in naira floats and rounded at the end drifts by a kobo per sale, and a
 * ledger that disagrees with the bank by a kobo is a ledger nobody trusts.
 */
export interface FeeSchedule {
  /** Basis points, so 150 = 1.5%. Integers, to keep float rounding out. */
  rateBps: number;
  /**
   * Floor, in kobo.
   *
   * Not optional in practice: every sale costs a WhatsApp utility template
   * (~₦13.50 from October 2026), so a pure percentage loses money on small
   * orders — at 1.5% anything under about ₦1,800 costs more to process than
   * it earns. Tees Kitchen lists at ₦100.
   */
  minFee: Kobo;
  /**
   * Ceiling, in kobo.
   *
   * Paystack caps its own cut at ₦300. An uncapped percentage would charge
   * many multiples of the rail's cost on a large order — 12× on ₦150,000,
   * 42× on ₦500,000 — and a merchant selling a generator would simply send
   * her account number instead.
   */
  maxFee: Kobo;
  /**
   * Share of the fee the BUYER pays, in basis points of the fee itself.
   * 5000 = half. The rest is deducted from the merchant's payout.
   */
  buyerShareBps: number;
}

export const DEFAULT_FEE_SCHEDULE: FeeSchedule = {
  rateBps: 150, // 1.5%
  minFee: 25_00,
  maxFee: 500_00,
  buyerShareBps: 5000, // split down the middle
};

export interface FeeBreakdown {
  /** What the merchant listed the item for. */
  listed: Kobo;
  /** Total Rhodium fee on this sale. */
  platformFee: Kobo;
  /** Part of the fee added to what the buyer is charged. */
  buyerShare: Kobo;
  /** Part of the fee taken out of the merchant's payout. */
  merchantShare: Kobo;
  /** What the buyer is actually charged: listed + buyerShare. */
  buyerPays: Kobo;
  /** Whether the floor or the ceiling decided the fee, rather than the rate. */
  bound: "min" | "max" | null;
}

/**
 * Work out the fee on one sale.
 *
 * The buyer's share is ADDED to the listed price rather than taken out of it:
 * a merchant who lists at ₦5,000 must receive her ₦5,000 less only her own
 * share, otherwise every price she sets quietly means something else.
 */
export function computeFees(listed: Kobo, schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE): FeeBreakdown {
  if (!Number.isInteger(listed) || listed < 0) {
    throw new Error(`listed price must be a whole number of kobo, got ${listed}`);
  }

  const byRate = Math.round((listed * schedule.rateBps) / 10_000);

  let platformFee = byRate;
  let bound: "min" | "max" | null = null;
  if (byRate < schedule.minFee) {
    platformFee = schedule.minFee;
    bound = "min";
  } else if (byRate > schedule.maxFee) {
    platformFee = schedule.maxFee;
    bound = "max";
  }

  // The buyer's share is rounded and the merchant takes the remainder, so the
  // two always sum to exactly the fee. Rounding both independently would leave
  // a stray kobo that belongs to nobody.
  const buyerShare = Math.round((platformFee * schedule.buyerShareBps) / 10_000);
  const merchantShare = platformFee - buyerShare;

  return {
    listed,
    platformFee,
    buyerShare,
    merchantShare,
    buyerPays: listed + buyerShare,
    bound,
  };
}

/**
 * Paystack's own cut: 1% capped at ₦300 on a dedicated virtual account.
 *
 * Verified against live transactions (₦100 charged ₦1.00) and their published
 * pricing. Comes off the top before anyone else is paid, so the merchant's
 * take-home is the charged amount less this and less her share of our fee.
 */
export function paystackFee(charged: Kobo): Kobo {
  return Math.min(Math.round(charged * 0.01), 300_00);
}

/** What actually reaches the merchant's bank. */
export function merchantNet(breakdown: FeeBreakdown): Kobo {
  return breakdown.buyerPays - paystackFee(breakdown.buyerPays) - breakdown.platformFee;
}
