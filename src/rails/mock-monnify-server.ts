/**
 * In-process simulator of the Monnify bits the MVP touches: reserved (virtual)
 * account creation per order, and a signed SUCCESSFUL_TRANSACTION webhook. Lets
 * the whole bank loop run with no Monnify credentials. Swap to live and it hits
 * the real API with the same adapter contract.
 */
import { createHmac } from "node:crypto";
import { ref } from "../lib/ids.js";
import type { Kobo } from "../lib/money.js";

interface MockReserved {
  accountReference: string; // = our order id
  accountNumber: string;
  bankName: string;
  accountName: string;
  amount: Kobo;
  status: "pending" | "paid";
  txReference?: string;
}

export interface SignedWebhook {
  rawBody: string;
  signature: string; // value for the monnify-signature header
}

const BANKS = ["Moniepoint MFB", "Wema Bank", "Sterling Bank"];

export class MockMonnifyServer {
  private accounts = new Map<string, MockReserved>();
  constructor(private secret: string) {}

  createReservedAccount(input: {
    orderId: string;
    amount: Kobo;
    businessName: string;
  }): MockReserved {
    const acct: MockReserved = {
      accountReference: input.orderId,
      accountNumber: this.randomNuban(),
      bankName: BANKS[Math.floor(Math.random() * BANKS.length)]!,
      accountName: `RHODIUM/${input.businessName}`.slice(0, 40).toUpperCase(),
      amount: input.amount,
      status: "pending",
    };
    this.accounts.set(input.orderId, acct);
    return acct;
  }

  getByReference(reference: string): MockReserved | undefined {
    return this.accounts.get(reference);
  }

  /** Simulate a buyer transfer → Monnify posts a signed SUCCESSFUL_TRANSACTION. */
  simulateTransfer(orderId: string, overrideAmount?: Kobo): SignedWebhook {
    const acct = this.accounts.get(orderId);
    if (!acct) throw new Error(`unknown reserved account ${orderId}`);
    acct.status = "paid";
    acct.txReference = ref("MNFY");
    return this.buildWebhook(acct, overrideAmount ?? acct.amount);
  }

  replayLastTransfer(orderId: string): SignedWebhook {
    const acct = this.accounts.get(orderId);
    if (!acct?.txReference) throw new Error(`no prior transfer for ${orderId}`);
    return this.buildWebhook(acct, acct.amount);
  }

  private buildWebhook(acct: MockReserved, amountKobo: Kobo): SignedWebhook {
    const body = {
      eventType: "SUCCESSFUL_TRANSACTION",
      eventData: {
        transactionReference: acct.txReference,
        paymentReference: acct.accountReference,
        amountPaid: (amountKobo / 100).toFixed(2), // Monnify sends naira strings
        paymentStatus: "PAID",
        product: { reference: acct.accountReference, type: "RESERVED_ACCOUNT" },
      },
    };
    return this.sign(JSON.stringify(body));
  }

  private sign(rawBody: string): SignedWebhook {
    // Monnify signs the raw body with HMAC-SHA512 using the client secret.
    return { rawBody, signature: createHmac("sha512", this.secret).update(rawBody).digest("hex") };
  }

  private randomNuban(): string {
    let s = "";
    for (let i = 0; i < 10; i++) s += Math.floor(Math.random() * 10);
    return s;
  }
}
