import { describe, it, expect } from "vitest";
import {
  computeFees,
  merchantNet,
  paystackFee,
  DEFAULT_FEE_SCHEDULE,
  type FeeSchedule,
} from "../src/modules/fees/fee-schedule.js";

/**
 * This decides what a merchant is paid. Every case below is one someone will
 * actually hit — a ₦100 soup, a ₦500,000 generator — rather than a round
 * number chosen to make the arithmetic tidy.
 */

describe("the fee itself", () => {
  it("is the rate in the ordinary middle of the range", () => {
    // ₦5,000 at 1.5% = ₦75, comfortably between floor and ceiling.
    const f = computeFees(5_000_00);
    expect(f.platformFee).toBe(75_00);
    expect(f.bound).toBeNull();
  });

  it("never falls below the floor, because small orders still cost us", () => {
    // Tees Kitchen lists at ₦100. 1.5% of that is ₦1.50, and the WhatsApp
    // receipt alone costs about ₦13.50 — the floor is what stops every small
    // sale losing money.
    const f = computeFees(100_00);
    expect(f.platformFee).toBe(25_00);
    expect(f.bound).toBe("min");
  });

  it("never rises above the ceiling, however large the order", () => {
    for (const listed of [50_000_00, 150_000_00, 500_000_00, 5_000_000_00]) {
      const f = computeFees(listed);
      expect(f.platformFee, `on ₦${listed / 100}`).toBe(500_00);
      expect(f.bound).toBe("max");
    }
  });

  it("switches from floor to rate exactly where it should", () => {
    // 1.5% reaches the ₦25 floor at ₦1,666.67, so the crossover sits between
    // ₦1,666 and ₦1,667 — worth pinning exactly, because an off-by-one here
    // is a fee that is wrong on every order near the boundary.
    expect(computeFees(1_666_00).platformFee).toBe(25_00);
    expect(computeFees(1_666_00).bound).toBe("min"); // rate gives ₦24.99
    expect(computeFees(1_667_00).bound).toBeNull(); // rate gives ₦25.01
    expect(computeFees(1_667_00).platformFee).toBe(25_01);
    expect(computeFees(1_700_00).platformFee).toBe(25_50);
  });
});

describe("who pays it", () => {
  it("splits down the middle by default", () => {
    const f = computeFees(10_000_00);
    expect(f.platformFee).toBe(150_00);
    expect(f.buyerShare).toBe(75_00);
    expect(f.merchantShare).toBe(75_00);
  });

  it("always sums to exactly the fee, with no stray kobo", () => {
    // Rounding both shares independently would leave a kobo belonging to
    // nobody, and a ledger that is one kobo out is a ledger nobody trusts.
    for (let listed = 1_00; listed <= 200_000_00; listed += 997) {
      const f = computeFees(listed);
      expect(f.buyerShare + f.merchantShare, `at ₦${listed / 100}`).toBe(f.platformFee);
    }
  });

  it("adds the buyer's share on top of the listed price, never out of it", () => {
    // A merchant who lists at ₦5,000 must see ₦5,000, less only her own
    // share. Taking the buyer's half out of her price would mean every figure
    // she types quietly means something else.
    const f = computeFees(5_000_00);
    expect(f.buyerPays).toBe(5_000_00 + f.buyerShare);
    expect(f.buyerPays).toBeGreaterThan(f.listed);
  });

  it("can be shifted entirely onto either side", () => {
    const allBuyer: FeeSchedule = { ...DEFAULT_FEE_SCHEDULE, buyerShareBps: 10_000 };
    const allMerchant: FeeSchedule = { ...DEFAULT_FEE_SCHEDULE, buyerShareBps: 0 };
    expect(computeFees(10_000_00, allBuyer).merchantShare).toBe(0);
    expect(computeFees(10_000_00, allMerchant).buyerShare).toBe(0);
  });
});

describe("what the merchant actually receives", () => {
  it("is the charge less Paystack and less her share", () => {
    const f = computeFees(5_000_00);
    const charged = f.buyerPays;              // 5,037.50
    const ps = paystackFee(charged);          // 1% = 50.38
    expect(merchantNet(f)).toBe(charged - ps - f.platformFee);
  });

  it("costs her about 1.75% in the middle of the range", () => {
    for (const listed of [2_000_00, 5_000_00, 15_000_00]) {
      const f = computeFees(listed);
      const cost = ((listed - merchantNet(f)) / listed) * 100;
      expect(cost, `on ₦${listed / 100}`).toBeGreaterThan(1.5);
      expect(cost).toBeLessThan(2.1);
    }
  });

  it("costs her LESS as the order grows, because both fees cap", () => {
    // The story a merchant can actually hear: it never gets worse than ~2%,
    // and big orders are cheaper.
    const small = computeFees(5_000_00);
    const large = computeFees(150_000_00);
    const costSmall = (small.listed - merchantNet(small)) / small.listed;
    const costLarge = (large.listed - merchantNet(large)) / large.listed;
    expect(costLarge).toBeLessThan(costSmall);
    expect(costLarge).toBeLessThan(0.01);
  });

  it("never pays out more than came in", () => {
    // The invariant that matters: we cannot credit a merchant money that was
    // never charged, at any price point.
    for (let listed = 1_00; listed <= 500_000_00; listed += 3_331) {
      const f = computeFees(listed);
      expect(merchantNet(f) + paystackFee(f.buyerPays) + f.platformFee).toBe(f.buyerPays);
      expect(merchantNet(f)).toBeLessThanOrEqual(f.buyerPays);
    }
  });
});

describe("Paystack's own cut", () => {
  it("matches what they actually charged us", () => {
    // Three live ₦100 transactions were each charged exactly ₦1.00.
    expect(paystackFee(100_00)).toBe(1_00);
  });

  it("caps at ₦300", () => {
    expect(paystackFee(30_000_00)).toBe(300_00);
    expect(paystackFee(1_000_000_00)).toBe(300_00);
  });
});

describe("guarding against nonsense input", () => {
  it("refuses a non-integer or negative price", () => {
    // Money arrives here as kobo integers. A float means someone did naira
    // arithmetic upstream, and the rounding error is already in the number.
    expect(() => computeFees(10.5)).toThrow(/whole number/i);
    expect(() => computeFees(-100)).toThrow();
  });

  it("handles a zero-price item without inventing a fee to charge on it", () => {
    const f = computeFees(0);
    expect(f.platformFee).toBe(DEFAULT_FEE_SCHEDULE.minFee);
    expect(f.buyerPays).toBe(f.buyerShare);
  });
});
