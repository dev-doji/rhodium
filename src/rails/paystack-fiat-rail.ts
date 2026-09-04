import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  PaymentRail,
  PaymentInstruction,
  PaymentEvent,
  PaymentStatusResult,
  WebhookPayload,
  SettlementTarget,
} from "./types.js";
import type { Merchant, Order, RailId } from "../domain/types.js";
import { MockPaystackServer } from "./mock-paystack-server.js";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

const log = logger("paystack-rail");

interface PaystackConfig {
  mode: "mock" | "live";
  secretKey: string;
  baseUrl: string;
  /** Bank the dedicated accounts are issued against (wema-bank, titan-bank…). */
  dvaBank: string;
}

/**
 * Bank rail via Paystack — the same `PaymentRail` interface as Monnify, so the
 * two are interchangeable behind `FIAT_PROVIDER`.
 *
 * Each order gets its own **dedicated virtual account**, which is what keeps the
 * buyer experience identical to Monnify's: "transfer to this account, we detect
 * it", no screenshot. The account is per-order, so an inbound transfer maps to
 * exactly one order with no matching heuristics.
 *
 * `mock` mode drives an in-process simulator. That matters more here than it did
 * for Monnify: the Paystack key is LIVE, and a stray test against it creates
 * real customers and moves real money.
 *
 * Live specifics marked [VALIDATE] should be checked against the Paystack
 * dashboard before the first real naira moves.
 */
export class PaystackFiatRail implements PaymentRail {
  readonly id: RailId = "paystack";
  readonly kind = "fiat" as const;
  readonly mock?: MockPaystackServer;

  constructor(private cfg: PaystackConfig) {
    if (cfg.mode === "mock") {
      this.mock = new MockPaystackServer(cfg.secretKey || "mock-secret");
    }
  }

  /**
   * NO CUSTODY: funds settle to the merchant's own bank account. Where a
   * subaccount exists, Paystack splits straight to it and Rhodium never holds a
   * balance — `processorSubaccountCode` carries that from onboarding.
   */
  settlementTarget(merchant: Merchant): SettlementTarget {
    return {
      kind: "bank_account",
      bankCode: merchant.settlementBankCode,
      accountNumber: merchant.settlementAccountNumber,
      owner: "merchant",
    };
  }

  async createPaymentInstruction(order: Order, merchant: Merchant): Promise<PaymentInstruction> {
    if (this.cfg.mode === "mock") {
      const acct = this.mock!.createDedicatedAccount({
        orderId: order.id,
        amount: order.amount,
        businessName: merchant.businessName,
      });
      return {
        railId: this.id,
        instructionType: "dva",
        // The ACCOUNT NUMBER, not the order id. A DVA webhook identifies itself
        // by the receiving account; our order id never reaches Paystack. Live
        // DVAs are also per-customer and reused, which is exactly why the repo
        // matches the oldest PENDING payment on this ref.
        providerRef: acct.accountNumber,
        amount: order.amount,
        accountNumber: acct.accountNumber,
        bankName: acct.bankName,
        accountName: acct.accountName,
      };
    }

    // --- live ---
    // NO CUSTODY, enforced rather than hoped for. Without a subaccount Paystack
    // settles the money into OUR balance, which is precisely the thing this
    // product promises never to do, and in Nigeria is the difference between
    // routing a payment and holding customer funds. Refusing the payment is the
    // safe failure: the buyer sees "we could not set up your payment", which is
    // recoverable, where silently taking custody is not.
    if (!merchant.processorSubaccountCode) {
      log.error(
        { merchantId: merchant.id, orderId: order.id },
        "refusing paystack DVA: merchant has no subaccount, funds would land in our balance",
      );
      throw new AppError(
        "merchant is not set up to receive payments yet",
        "merchant_not_payable",
        409,
      );
    }

    // Paystack needs a customer before it will issue a dedicated account, so
    // this is two calls. The buyer's phone is the customer identity; the email
    // is synthesised because WhatsApp buyers do not give one and Paystack
    // requires the field.
    const customer = await this.api<{ data?: { customer_code?: string } }>("/customer", {
      method: "POST",
      body: JSON.stringify({
        email: `${digits(order.buyerRef)}@buyers.userhodium.xyz`,
        phone: order.buyerRef,
        first_name: "Rhodium",
        last_name: "Buyer",
      }),
    });
    const customerCode = customer.data?.customer_code;
    if (!customerCode) throw new AppError("paystack: no customer_code", "provider_error", 502);

    const dva = await this.api<{
      data?: { account_number?: string; account_name?: string; bank?: { name?: string } };
    }>("/dedicated_account", {
      method: "POST",
      body: JSON.stringify({
        customer: customerCode,
        preferred_bank: this.cfg.dvaBank,
        // The subaccount is what makes Paystack split the money straight to
        // the merchant. It is required, not optional — see the guard above.
        subaccount: merchant.processorSubaccountCode,
      }),
    });

    const accountNumber = dva.data?.account_number;
    if (!accountNumber) {
      throw new AppError("paystack: no account_number on dedicated account", "provider_error", 502);
    }
    return {
      railId: this.id,
      instructionType: "dva",
      providerRef: accountNumber, // see the mock branch above
      amount: order.amount,
      accountNumber,
      bankName: dva.data?.bank?.name,
      accountName: dva.data?.account_name,
    };
  }

  async handleWebhook(raw: WebhookPayload): Promise<PaymentEvent> {
    const sig = raw.headers["x-paystack-signature"];
    if (!this.verifySignature(raw.rawBody, sig)) {
      throw new AppError("invalid paystack signature", "bad_signature", 401);
    }
    const body = JSON.parse(raw.rawBody) as {
      event: string;
      data: {
        id: number;
        amount: number; // KOBO — no conversion needed
        status: string;
        reference?: string;
        metadata?: { receiver_account_number?: string };
        authorization?: { receiver_bank_account_number?: string };
      };
    };
    const data = body.data ?? ({} as never);
    // A DVA transfer identifies itself by the account the money landed in.
    // Paystack owns `metadata` for these events — it holds receiver details,
    // never anything we set — and its `reference` belongs to the transaction
    // rather than to our order, so neither can identify which order was paid.
    const providerRef =
      data.metadata?.receiver_account_number ??
      data.authorization?.receiver_bank_account_number ??
      "unknown";
    const eventId = String(data.id ?? data.reference ?? "unknown");

    if (body.event !== "charge.success" || data.status !== "success") {
      return {
        railId: this.id,
        providerRef,
        status: "ignored",
        idempotencyKey: `paystack:${eventId}:${body.event}`,
      };
    }
    return {
      railId: this.id,
      providerRef,
      status: "confirmed",
      amount: data.amount, // already kobo
      // Keyed on Paystack's transaction id: a replayed webhook collapses to one
      // ledger entry rather than crediting the merchant twice.
      idempotencyKey: `paystack:${eventId}`,
      rawEventId: eventId,
    };
  }

  async verifyPayment(providerRef: string): Promise<PaymentStatusResult> {
    if (this.cfg.mode === "mock") {
      const acct = this.mock!.getByReference(providerRef);
      if (!acct) return { providerRef, status: "pending" };
      if (acct.status !== "paid") return { providerRef, status: "pending" };
      return {
        providerRef,
        status: "confirmed",
        amount: acct.amount,
        rawEventId: String(acct.txId ?? ""),
      };
    }
    // providerRef is a dedicated-account NUMBER, not a transaction reference —
    // /transaction/verify rejects it with "Transaction reference not found".
    // Find the most recent successful transfer that landed in this account.
    type Tx = {
      id?: number;
      amount?: number;
      status?: string;
      metadata?: { receiver_account_number?: string };
      authorization?: { receiver_bank_account_number?: string };
    };
    const res = await this.api<{ data?: Tx[] }>(
      "/transaction?perPage=50&status=success",
      { method: "GET" },
    ).catch(() => null);
    const hit = (res?.data ?? []).find(
      (t) =>
        (t.metadata?.receiver_account_number ??
          t.authorization?.receiver_bank_account_number) === providerRef,
    );
    if (!hit) return { providerRef, status: "pending" };
    return {
      providerRef,
      status: "confirmed",
      amount: hit.amount,
      rawEventId: String(hit.id ?? ""),
    };
  }

  private verifySignature(rawBody: string, sig: string | undefined): boolean {
    if (!sig) return false;
    // Paystack signs with the SECRET KEY itself — there is no separate webhook
    // secret, so anyone chasing a `PAYSTACK_WEBHOOK_SECRET` is chasing nothing.
    const secret = this.cfg.secretKey || "mock-secret";
    const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Create the Paystack subaccount that money settles into.
   *
   * This is the piece that was missing: `processorSubaccountCode` was read on
   * every payment and persisted by the repositories, but nothing ever set it,
   * so every merchant would have settled into the platform balance.
   *
   * `percentage_charge: 0` means Paystack sends the merchant the whole amount.
   * Rhodium's cut, when there is one, is a separate decision — taking it here
   * would silently make the platform a fee-charging intermediary on every
   * order.
   */
  async createSubaccount(merchant: Merchant): Promise<string> {
    if (!merchant.settlementBankCode || !merchant.settlementAccountNumber) {
      throw new AppError(
        "cannot create a subaccount without the merchant's bank details",
        "validation",
        422,
      );
    }

    if (this.cfg.mode === "mock") {
      return this.mock!.createSubaccount(merchant.id);
    }

    const res = await this.api<{ data?: { subaccount_code?: string } }>("/subaccount", {
      method: "POST",
      body: JSON.stringify({
        business_name: merchant.businessName,
        settlement_bank: merchant.settlementBankCode,
        account_number: merchant.settlementAccountNumber,
        percentage_charge: 0,
      }),
    });
    const code = res.data?.subaccount_code;
    if (!code) throw new AppError("paystack: no subaccount_code", "provider_error", 502);
    log.info({ merchantId: merchant.id, code }, "paystack subaccount created");
    return code;
  }

  private async api<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.cfg.secretKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      log.error({ path, status: res.status, text: await res.text() }, "paystack api error");
      throw new AppError(`paystack api ${res.status}`, "provider_error", 502);
    }
    return (await res.json()) as T;
  }
}

/** Digits only — a synthesised customer email must not carry a `+`. */
function digits(s: string): string {
  return (s ?? "").replace(/\D/g, "") || "buyer";
}
