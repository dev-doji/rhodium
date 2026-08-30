/**
 * In-process simulator of the Paystack bits the MVP touches: a customer, a
 * dedicated virtual account per order, and a signed `charge.success` webhook.
 * Lets the whole bank loop run with no Paystack credentials — which matters
 * more here than it did for Monnify, because the Paystack key is LIVE and a
 * stray test would create real customers and move real money.
 */
import { createHmac } from "node:crypto";
import { ref } from "../lib/ids.js";
import type { Kobo } from "../lib/money.js";

interface MockDedicatedAccount {
  reference: string; // = our order id
  accountNumber: string;
  bankName: string;
  accountName: string;
  amount: Kobo;
  status: "pending" | "paid";
  /** Paystack's own transaction id — the idempotency anchor. */
  txId?: number;
}

export interface SignedPaystackWebhook {
  rawBody: string;
  signature: string; // value for the x-paystack-signature header
}

const BANKS = ["Wema Bank", "Titan Bank", "Paystack-Titan"];

export class MockPaystackServer {
  private accounts = new Map<string, MockDedicatedAccount>();
  private nextTxId = 900_000_001;

  constructor(private secret: string) {}

  createDedicatedAccount(input: {
    orderId: string;
    amount: Kobo;
    businessName: string;
  }): MockDedicatedAccount {
    const acct: MockDedicatedAccount = {
      reference: input.orderId,
      accountNumber: this.randomNuban(),
      bankName: BANKS[Math.floor(Math.random() * BANKS.length)]!,
      accountName: `RHODIUM/${input.businessName}`.slice(0, 40).toUpperCase(),
      amount: input.amount,
      status: "pending",
    };
    this.accounts.set(input.orderId, acct);
    return acct;
  }

  getByReference(reference: string): MockDedicatedAccount | undefined {
    return this.accounts.get(reference);
  }

  /** Simulate a buyer transfer → Paystack posts a signed `charge.success`. */
  simulateTransfer(orderId: string, overrideAmount?: Kobo): SignedPaystackWebhook {
    const acct = this.accounts.get(orderId);
    if (!acct) throw new Error(`unknown dedicated account ${orderId}`);
    acct.status = "paid";
    acct.txId = this.nextTxId++;
    return this.buildWebhook(acct, overrideAmount ?? acct.amount);
  }

  /** Same transaction id again — must collapse to one ledger entry. */
  replayLastTransfer(orderId: string): SignedPaystackWebhook {
    const acct = this.accounts.get(orderId);
    if (!acct?.txId) throw new Error(`no prior transfer for ${orderId}`);
    return this.buildWebhook(acct, acct.amount);
  }

  private buildWebhook(acct: MockDedicatedAccount, amountKobo: Kobo): SignedPaystackWebhook {
    const body = {
      event: "charge.success",
      data: {
        id: acct.txId,
        // Paystack sends amounts in KOBO already — unlike Monnify, which sends
        // naira strings. No conversion, and no rounding to get wrong.
        amount: amountKobo,
        currency: "NGN",
        status: "success",
        reference: ref("psk").replace("psk_", ""),
        channel: "dedicated_nuban",
        metadata: { order_id: acct.reference },
        customer: { customer_code: `CUS_${acct.reference.slice(-10)}` },
      },
    };
    return this.sign(JSON.stringify(body));
  }

  private sign(rawBody: string): SignedPaystackWebhook {
    // Paystack signs the raw body with HMAC-SHA512 using the SECRET KEY —
    // there is no separate webhook secret, unlike some providers.
    return {
      rawBody,
      signature: createHmac("sha512", this.secret).update(rawBody).digest("hex"),
    };
  }

  private randomNuban(): string {
    let s = "";
    for (let i = 0; i < 10; i++) s += Math.floor(Math.random() * 10);
    return s;
  }
}
