/**
 * In-process simulator of the parts of Paystack the MVP touches:
 *  - dedicated virtual account (DVA) creation per order,
 *  - an incoming bank transfer producing a signed `charge.success` webhook.
 *
 * This is what lets the ENTIRE magic-moment loop run and be tested with zero
 * external credentials. Swap FIAT_ADAPTER_MODE=live to hit the real API; the
 * adapter contract is identical.
 */
import { createHmac } from "node:crypto";
import { ref } from "../lib/ids.js";
import type { Kobo } from "../lib/money.js";

interface MockDva {
  providerRef: string;
  accountNumber: string;
  bankName: string;
  accountName: string;
  amount: Kobo;
  status: "pending" | "success" | "failed";
  chargeEventId?: string;
  chargeReference?: string;
}

export interface SignedWebhook {
  rawBody: string;
  signature: string; // value for x-paystack-signature
}

const BANKS = ["Wema Bank", "Titan Trust Bank", "Providus Bank"];

export class MockPaystackServer {
  private accounts = new Map<string, MockDva>();

  constructor(private secret: string) {}

  createDedicatedAccount(input: {
    orderId: string;
    amount: Kobo;
    businessName: string;
  }): MockDva {
    // providerRef IS the account number — the stable key the webhook echoes
    // back via authorization.receiver_bank_account_number (matches live).
    const accountNumber = this.randomNuban();
    const dva: MockDva = {
      providerRef: accountNumber,
      accountNumber,
      bankName: BANKS[Math.floor(Math.random() * BANKS.length)]!,
      accountName: `RHODIUM/${input.businessName}`.slice(0, 40).toUpperCase(),
      amount: input.amount,
      status: "pending",
    };
    this.accounts.set(accountNumber, dva);
    return dva;
  }

  getAccount(providerRef: string): MockDva | undefined {
    return this.accounts.get(providerRef);
  }

  /**
   * Simulate a buyer transferring into the DVA. Returns a signed webhook body,
   * exactly as Paystack would POST it, so tests/demo drive the real code path.
   * `overrideAmount` lets tests force an amount mismatch (fraud/drift cases).
   */
  simulateTransfer(providerRef: string, overrideAmount?: Kobo): SignedWebhook {
    const dva = this.accounts.get(providerRef);
    if (!dva) throw new Error(`unknown DVA ${providerRef}`);
    dva.status = "success";
    dva.chargeEventId = ref("evt");
    dva.chargeReference = ref("txn");
    const body = {
      event: "charge.success",
      data: {
        id: dva.chargeEventId,
        reference: dva.chargeReference, // per-charge reference (unique per transfer)
        amount: overrideAmount ?? dva.amount, // kobo
        currency: "NGN",
        status: "success",
        channel: "dedicated_nuban",
        authorization: {
          channel: "dedicated_nuban",
          receiver_bank_account_number: dva.accountNumber,
        },
      },
    };
    return this.sign(JSON.stringify(body));
  }

  /** A duplicate delivery of the SAME charge (idempotency test). */
  replayLastTransfer(providerRef: string): SignedWebhook {
    const dva = this.accounts.get(providerRef);
    if (!dva || !dva.chargeEventId) {
      throw new Error(`no prior transfer for ${providerRef}`);
    }
    const body = {
      event: "charge.success",
      data: {
        id: dva.chargeEventId,
        reference: dva.chargeReference,
        amount: dva.amount,
        currency: "NGN",
        status: "success",
        channel: "dedicated_nuban",
        authorization: {
          channel: "dedicated_nuban",
          receiver_bank_account_number: dva.accountNumber,
        },
      },
    };
    return this.sign(JSON.stringify(body));
  }

  private sign(rawBody: string): SignedWebhook {
    // Paystack signs with HMAC-SHA512 of the raw body using the secret key.
    const signature = createHmac("sha512", this.secret)
      .update(rawBody)
      .digest("hex");
    return { rawBody, signature };
  }

  private randomNuban(): string {
    let s = "";
    for (let i = 0; i < 10; i++) s += Math.floor(Math.random() * 10);
    return s;
  }
}
