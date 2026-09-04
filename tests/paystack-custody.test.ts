import { describe, it, expect, beforeEach } from "vitest";
import { PaystackFiatRail } from "../src/rails/paystack-fiat-rail.js";
import type { Merchant, Order } from "../src/domain/types.js";

/**
 * The no-custody rule, pinned down.
 *
 * Rhodium's whole promise is that money never passes through its balance. On
 * Paystack that is not automatic: a dedicated account issued WITHOUT a
 * subaccount settles into the platform's own balance. That is the difference
 * between routing a payment and holding customer funds, which in Nigeria is a
 * licensing question, not a preference.
 *
 * So the rail must refuse rather than quietly take the money.
 */

const merchant = (over: Partial<Merchant> = {}): Merchant => ({
  id: "mch_1",
  phone: "+2348030001111",
  businessName: "Circuit City",
  status: "active",
  kycState: "verified",
  cryptoEnabled: false,
  settlementBankCode: "058",
  settlementAccountNumber: "0123456789",
  createdAt: new Date(),
  ...over,
});

const order: Order = {
  id: "ord_1",
  merchantId: "mch_1",
  buyerRef: "+2348031234567",
  items: [],
  amount: 25_000_00,
  rail: "fiat",
  status: "draft",
  createdAt: new Date(),
};

let live: PaystackFiatRail;

beforeEach(() => {
  // `live` mode without touching the network: the guard must fire before any
  // HTTP call is attempted, which is itself part of the guarantee.
  live = new PaystackFiatRail({
    mode: "live",
    secretKey: "sk_test_not_used",
    baseUrl: "http://127.0.0.1:9/unreachable",
    dvaBank: "wema-bank",
  });
});

describe("no custody on the Paystack rail", () => {
  it("refuses to issue an account when the merchant has no subaccount", async () => {
    await expect(
      live.createPaymentInstruction(order, merchant({ processorSubaccountCode: undefined })),
    ).rejects.toThrow(/not set up to receive payments/i);
  });

  it("fails before making any network call", async () => {
    // The base URL is a dead port. If the guard did not fire first this would
    // surface as a connection error instead.
    // `.catch(e => e)` widens the type to the union of the resolved value and
    // the error, so narrow explicitly rather than reaching for `.message` on
    // something TypeScript still believes might be a PaymentInstruction.
    const outcome: unknown = await live
      .createPaymentInstruction(order, merchant())
      .then(() => null, (e: unknown) => e);

    expect(outcome).toBeInstanceOf(Error);
    const message = (outcome as Error).message;
    expect(message).toMatch(/not set up to receive payments/i);
    expect(message).not.toMatch(/fetch|ECONNREFUSED|connect/i);
  });

  it("names the merchant's own bank as the settlement target", () => {
    const target = live.settlementTarget(merchant());
    expect(target.owner).toBe("merchant");
    expect(target.accountNumber).toBe("0123456789");
  });
});

describe("creating the payout account", () => {
  it("mints a subaccount in mock mode", async () => {
    const mock = new PaystackFiatRail({
      mode: "mock", secretKey: "sk_mock", baseUrl: "http://unused", dvaBank: "wema-bank",
    });
    const code = await mock.createSubaccount(merchant());
    expect(code).toMatch(/^ACCT_/);
    // Deterministic, so onboarding run twice cannot mint two subaccounts.
    expect(await mock.createSubaccount(merchant())).toBe(code);
  });

  it("refuses without bank details, since there is nowhere to settle", async () => {
    const mock = new PaystackFiatRail({
      mode: "mock", secretKey: "sk_mock", baseUrl: "http://unused", dvaBank: "wema-bank",
    });
    await expect(
      mock.createSubaccount(merchant({ settlementAccountNumber: undefined })),
    ).rejects.toThrow(/bank details/i);
  });
});
