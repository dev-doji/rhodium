import { describe, it, expect } from "vitest";
import { PaystackFiatRail } from "../src/rails/paystack-fiat-rail.js";
import { AppError } from "../src/lib/errors.js";
import type { Merchant, Order } from "../src/domain/types.js";

const SECRET = "sk_test_pretend";

function rail() {
  return new PaystackFiatRail({
    mode: "mock",
    secretKey: SECRET,
    baseUrl: "https://api.paystack.co",
    dvaBank: "wema-bank",
  });
}

const merchant = {
  id: "mch_p", phone: "+2348030000001", businessName: "Circuit City",
  status: "active", kycState: "verified", cryptoEnabled: false,
  settlementBankCode: "058", settlementAccountNumber: "0123456789",
  createdAt: new Date(),
} as Merchant;

const order = {
  id: "ord_paystack_1", merchantId: "mch_p", buyerRef: "+2349032621846",
  items: [], amount: 650_000, status: "awaiting_payment", rail: "fiat",
  createdAt: new Date(),
} as unknown as Order;

describe("Paystack bank rail", () => {
  it("issues a dedicated account the buyer can transfer to", async () => {
    const r = rail();
    const inst = await r.createPaymentInstruction(order, merchant);
    expect(inst.railId).toBe("paystack");
    expect(inst.instructionType).toBe("dva");
    expect(inst.accountNumber).toMatch(/^\d{10}$/);
    expect(inst.accountName).toContain("CIRCUIT CITY");
    // providerRef is the ACCOUNT NUMBER. A DVA webhook can only identify
    // itself by where the money landed; our order id never reaches Paystack.
    expect(inst.providerRef).toBe(inst.accountNumber);
  });

  it("confirms a signed charge.success and reads kobo without converting", async () => {
    const r = rail();
    const inst = await r.createPaymentInstruction(order, merchant);
    const hook = r.mock!.simulateTransfer(order.id);

    const event = await r.handleWebhook({
      headers: { "x-paystack-signature": hook.signature },
      rawBody: hook.rawBody,
    });

    expect(event.status).toBe("confirmed");
    // Paystack sends kobo already. Monnify sends naira strings; conflating the
    // two would credit this merchant ₦65,000,000 instead of ₦6,500.
    expect(event.amount).toBe(650_000);
    expect(event.providerRef).toBe(inst.accountNumber);
  });

  it("rejects a forged signature", async () => {
    const r = rail();
    await r.createPaymentInstruction(order, merchant);
    const hook = r.mock!.simulateTransfer(order.id);

    await expect(
      r.handleWebhook({
        headers: { "x-paystack-signature": "deadbeef" },
        rawBody: hook.rawBody,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("rejects a webhook with no signature at all", async () => {
    const r = rail();
    await r.createPaymentInstruction(order, merchant);
    const hook = r.mock!.simulateTransfer(order.id);
    await expect(
      r.handleWebhook({ headers: {}, rawBody: hook.rawBody }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("gives a replayed webhook the SAME idempotency key", async () => {
    const r = rail();
    await r.createPaymentInstruction(order, merchant);
    const sent = r.mock!.simulateTransfer(order.id);
    const first = await r.handleWebhook({
      headers: { "x-paystack-signature": sent.signature },
      rawBody: sent.rawBody,
    });
    const replay = r.mock!.replayLastTransfer(order.id);
    const second = await r.handleWebhook({
      headers: { "x-paystack-signature": replay.signature },
      rawBody: replay.rawBody,
    });
    // This is what stops a merchant being credited twice for one transfer.
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("ignores events that are not a successful charge", async () => {
    const r = rail();
    const body = JSON.stringify({
      event: "charge.failed",
      data: { id: 1, amount: 650_000, status: "failed", metadata: { receiver_account_number: "9816867854" } },
    });
    const { createHmac } = await import("node:crypto");
    const sig = createHmac("sha512", SECRET).update(body).digest("hex");

    const event = await r.handleWebhook({
      headers: { "x-paystack-signature": sig },
      rawBody: body,
    });
    expect(event.status).toBe("ignored");
  });

  it("settles to the MERCHANT's bank account, never to us", () => {
    const target = rail().settlementTarget(merchant);
    expect(target.owner).toBe("merchant");
    expect(target.accountNumber).toBe("0123456789");
  });
});

describe("Paystack through the whole payment loop", () => {
  it("credits the ledger once, even when the webhook is replayed", async () => {
    process.env.FIAT_PROVIDER = "paystack";
    process.env.FIAT_ADAPTER_MODE = "mock";
    const { makeApp, seedMerchant, seedProduct } = await import("./helpers/harness.js");
    const app = makeApp();
    try {
      const merchant = await seedMerchant(app);
      const product = await seedProduct(app, merchant.id, 650_000);
      const order = await app.commerce.createOrder({
        merchantId: merchant.id,
        buyerRef: "+2349032621846",
        lines: [{ productId: product.id, qty: 1 }],
      });
      const instruction = await app.payments.requestPayment(order.id);
      expect(instruction.railId).toBe("paystack");
      expect(instruction.accountNumber).toMatch(/^\d{10}$/);

      const psk = app.rails.get("paystack") as { mock?: { simulateTransfer: (id: string) => { rawBody: string; signature: string }; replayLastTransfer: (id: string) => { rawBody: string; signature: string } } };
      const hook = psk.mock!.simulateTransfer(instruction.providerRef);
      await app.payments.handleRailWebhook("paystack", {
        headers: { "x-paystack-signature": hook.signature },
        rawBody: hook.rawBody,
      });

      expect((await app.repos.orders.byId(order.id))!.status).toBe("paid");
      expect(await app.ledger.balance(merchant.id)).toBe(650_000);

      // Paystack retries webhooks it thinks failed. The ledger must not move.
      const replay = psk.mock!.replayLastTransfer(instruction.providerRef);
      await app.payments.handleRailWebhook("paystack", {
        headers: { "x-paystack-signature": replay.signature },
        rawBody: replay.rawBody,
      });
      expect(await app.ledger.balance(merchant.id)).toBe(650_000);
      expect(await app.ledger.entries(merchant.id)).toHaveLength(1);
    } finally {
      delete process.env.FIAT_PROVIDER;
    }
  });
});

describe("attach / detach a settlement subaccount", () => {
  it("binds a subaccount and can unbind it again", async () => {
    const { makeApp, seedMerchant } = await import("./helpers/harness.js");
    const app = makeApp();
    const merchant = await seedMerchant(app, { businessName: "Circuit City" });

    const bound = await app.repos.merchants.update(merchant.id, {
      processorSubaccountCode: "ACCT_kvj7p2t4pzz45au",
    });
    expect(bound.processorSubaccountCode).toBe("ACCT_kvj7p2t4pzz45au");

    // Empty string means unbind. Every field here used to guard on `!= null`,
    // so a subaccount was write-once and a test binding could never be undone —
    // the same bug also made "disconnect your WhatsApp number" impossible,
    // despite the privacy policy promising it.
    const cleared = await app.repos.merchants.update(merchant.id, {
      processorSubaccountCode: "",
    });
    expect(cleared.processorSubaccountCode).toBeUndefined();
  });

  it("leaves the subaccount alone when the patch omits it", async () => {
    const { makeApp, seedMerchant } = await import("./helpers/harness.js");
    const app = makeApp();
    const merchant = await seedMerchant(app);
    await app.repos.merchants.update(merchant.id, { processorSubaccountCode: "ACCT_keep" });
    const after = await app.repos.merchants.update(merchant.id, { businessName: "Renamed" });
    expect(after.processorSubaccountCode).toBe("ACCT_keep");
    expect(after.businessName).toBe("Renamed");
  });

  it("can disconnect a WhatsApp number, as the privacy policy promises", async () => {
    const { makeApp, seedMerchant } = await import("./helpers/harness.js");
    const app = makeApp();
    const merchant = await seedMerchant(app, { waPhoneNumberId: "PNID_X" });
    expect(await app.repos.merchants.byWaPhoneNumberId("PNID_X")).not.toBeNull();

    await app.repos.merchants.update(merchant.id, { waPhoneNumberId: "" });
    expect(await app.repos.merchants.byWaPhoneNumberId("PNID_X")).toBeNull();
  });
});

describe("checkout page reload", () => {
  it("keeps the account number across reloads instead of blanking it", async () => {
    process.env.FIAT_PROVIDER = "paystack";
    process.env.FIAT_ADAPTER_MODE = "mock";
    const { makeApp, seedMerchant, seedProduct } = await import("./helpers/harness.js");
    const app = makeApp();
    try {
      const merchant = await seedMerchant(app);
      const product = await seedProduct(app, merchant.id, 650_000);
      const order = await app.commerce.createOrder({
        merchantId: merchant.id,
        buyerRef: "+2349032621846",
        lines: [{ productId: product.id, qty: 1 }],
      });

      const first = await app.payments.requestPayment(order.id);
      expect(first.accountNumber).toMatch(/^\d{10}$/);

      // What the checkout page does on every load. It used to come back with
      // only `amount`, so the buyer saw an empty box and no way to pay while
      // their WhatsApp message held the real account number.
      const reload = await app.payments.requestPayment(order.id);
      expect(reload.accountNumber).toBe(first.accountNumber);
      expect(reload.bankName).toBe(first.bankName);
      expect(reload.accountName).toBe(first.accountName);
      expect(reload.providerRef).toBe(first.providerRef);
    } finally {
      delete process.env.FIAT_PROVIDER;
    }
  });
});

describe("matching a DVA transfer to its order", () => {
  it("matches on the receiving account number, as the real webhook does", async () => {
    const r = rail();
    const inst = await r.createPaymentInstruction(order, merchant);
    const hook = r.mock!.simulateTransfer(order.id);

    const event = await r.handleWebhook({
      headers: { "x-paystack-signature": hook.signature },
      rawBody: hook.rawBody,
    });

    // A live DVA payload carries only receiver details — Paystack owns
    // `metadata` for these events and our order id never reaches it. Matching
    // on anything else means a real transfer arrives and finds no order.
    expect(event.providerRef).toBe(inst.accountNumber);
    expect(event.providerRef).not.toBe(order.id);
    expect(JSON.parse(hook.rawBody).data.metadata.order_id).toBeUndefined();
  });

  it("falls back to authorization.receiver_bank_account_number", async () => {
    const r = rail();
    const body = JSON.stringify({
      event: "charge.success",
      data: {
        id: 99, amount: 650_000, status: "success",
        authorization: { receiver_bank_account_number: "9816867854" },
      },
    });
    const { createHmac } = await import("node:crypto");
    const sig = createHmac("sha512", SECRET).update(body).digest("hex");
    const event = await r.handleWebhook({
      headers: { "x-paystack-signature": sig },
      rawBody: body,
    });
    expect(event.providerRef).toBe("9816867854");
  });
});
