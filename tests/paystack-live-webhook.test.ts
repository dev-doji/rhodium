import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { PaystackFiatRail } from "../src/rails/paystack-fiat-rail.js";

/**
 * Proves the LIVE webhook path parses a real Paystack DVA `charge.success`
 * payload correctly — matching on `authorization.receiver_bank_account_number`
 * (the account we issued), keying idempotency on the per-charge `reference`,
 * and verifying the secret-key HMAC-SHA512 signature. Runs with NO network and
 * NO credentials (handleWebhook makes no API calls).
 */
const SECRET = "sk_test_example_secret_key";

function paystackWebhook(body: unknown) {
  const rawBody = JSON.stringify(body);
  const signature = createHmac("sha512", SECRET).update(rawBody).digest("hex");
  return { headers: { "x-paystack-signature": signature }, rawBody };
}

const realDvaCharge = {
  event: "charge.success",
  data: {
    id: 302961,
    reference: "rcqr8ptw3l",
    amount: 500000,
    currency: "NGN",
    status: "success",
    channel: "dedicated_nuban",
    authorization: {
      channel: "dedicated_nuban",
      receiver_bank_account_number: "1234567890",
      bank: "Wema Bank",
      sender_name: "AMAKA BUYER",
    },
    customer: { customer_code: "CUS_xyz", email: "buyer@x.com" },
  },
};

describe("live Paystack DVA webhook parsing", () => {
  const rail = new PaystackFiatRail({ mode: "live", secretKey: SECRET });

  it("matches on receiver_bank_account_number and keys idempotency on reference", async () => {
    const event = await rail.handleWebhook(paystackWebhook(realDvaCharge));
    expect(event.status).toBe("confirmed");
    expect(event.providerRef).toBe("1234567890"); // the DVA account, not the ref
    expect(event.amount).toBe(500000);
    expect(event.idempotencyKey).toBe("paystack:302961:charge.success");
    expect(event.rawEventId).toBe("302961");
  });

  it("rejects a payload with an invalid signature", async () => {
    const good = paystackWebhook(realDvaCharge);
    await expect(
      rail.handleWebhook({ headers: { "x-paystack-signature": "nope" }, rawBody: good.rawBody }),
    ).rejects.toThrow(/signature/);
  });

  it("ignores non-success events", async () => {
    const failed = { ...realDvaCharge, data: { ...realDvaCharge.data, status: "failed" } };
    const event = await rail.handleWebhook(paystackWebhook(failed));
    expect(event.status).toBe("ignored");
  });

  it("refuses to issue a live DVA when the merchant has no subaccount (no-custody guard)", async () => {
    await expect(
      rail.createPaymentInstruction(
        { id: "ord", amount: 500000 } as never,
        { id: "mch", businessName: "X", processorSubaccountCode: undefined } as never,
      ),
    ).rejects.toThrow(/subaccount/);
  });
});
