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
  /**
   * Seeded per process, not from a fixed constant.
   *
   * A provider's transaction id is what idempotency keys off. Starting every
   * process at the same number means the second run against a PERSISTENT
   * store replays the first: the event is judged already-processed, the ledger
   * correctly refuses to double-credit, and the sale silently never lands —
   * an order marked paid with nothing in the books. Fine against in-memory
   * doubles, which is why it survived; the real Postgres run is where it bit.
   */
  private nextTxId = 900_000_001 + Math.floor(Math.random() * 90_000_000);

  constructor(private secret: string) {}

  /**
   * Stand-in for Paystack's subaccount creation. Deterministic on the merchant
   * id so a test can assert the code without capturing it, and so re-running
   * onboarding in mock mode does not invent a second subaccount.
   */
  createSubaccount(merchantId: string): string {
    return `ACCT_mock_${merchantId.replace(/[^a-zA-Z0-9]/g, "").slice(-12)}`;
  }

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

  /**
   * Resolve by order id OR by account number. Callers hold whichever they have:
   * the rail knows the account number (that is the providerRef a webhook can
   * carry), while tests usually hold the order id.
   */
  getByReference(reference: string): MockDedicatedAccount | undefined {
    const direct = this.accounts.get(reference);
    if (direct) return direct;
    for (const a of this.accounts.values()) {
      if (a.accountNumber === reference) return a;
    }
    return undefined;
  }

  /** Simulate a buyer transfer → Paystack posts a signed `charge.success`. */
  simulateTransfer(reference: string, overrideAmount?: Kobo): SignedPaystackWebhook {
    const acct = this.getByReference(reference);
    if (!acct) throw new Error(`unknown dedicated account ${reference}`);
    acct.status = "paid";
    acct.txId = this.nextTxId++;
    return this.buildWebhook(acct, overrideAmount ?? acct.amount);
  }

  /** Same transaction id again — must collapse to one ledger entry. */
  replayLastTransfer(reference: string): SignedPaystackWebhook {
    const acct = this.getByReference(reference);
    if (!acct?.txId) throw new Error(`no prior transfer for ${reference}`);
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
        // Mirrors the REAL payload: Paystack owns metadata on DVA events and
        // fills it with receiver details. Our order id is nowhere in it — the
        // mock said otherwise, so the suite passed while production could not
        // match a single live transfer.
        metadata: {
          receiver_account_number: acct.accountNumber,
          receiver_bank: acct.bankName,
        },
        authorization: { receiver_bank_account_number: acct.accountNumber },
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
