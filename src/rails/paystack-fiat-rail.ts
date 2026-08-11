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
import { logger } from "../lib/logger.js";
import { AppError } from "../lib/errors.js";

const log = logger("paystack-rail");

interface PaystackConfig {
  mode: "mock" | "live";
  secretKey: string; // Paystack signs webhooks with THIS key (no separate secret)
  baseUrl?: string;
}

/**
 * Fiat adapter #1 (§2.2). One of Paystack/Moniepoint/Flutterwave — the shape is
 * the same. In `mock` mode it drives an in-process simulator (no credentials);
 * in `live` mode it calls the real DVA + charge-verify endpoints.
 */
export class PaystackFiatRail implements PaymentRail {
  readonly id: RailId = "paystack";
  readonly kind = "fiat" as const;
  readonly mock?: MockPaystackServer;
  private baseUrl: string;
  /** Paystack signs webhooks with the secret key. Mock uses a stand-in. */
  private signingSecret: string;

  constructor(private cfg: PaystackConfig) {
    this.baseUrl = cfg.baseUrl ?? "https://api.paystack.co";
    this.signingSecret = cfg.secretKey || "mock-secret";
    if (cfg.mode === "mock") {
      this.mock = new MockPaystackServer(this.signingSecret);
    }
  }

  settlementTarget(merchant: Merchant): SettlementTarget {
    // Funds settle into the MERCHANT's own bank account (no custody).
    return {
      kind: "bank_account",
      bankCode: merchant.settlementBankCode,
      accountNumber: merchant.settlementAccountNumber,
      owner: "merchant",
    };
  }

  async createPaymentInstruction(
    order: Order,
    merchant: Merchant,
  ): Promise<PaymentInstruction> {
    if (this.cfg.mode === "mock") {
      const dva = this.mock!.createDedicatedAccount({
        orderId: order.id,
        amount: order.amount,
        businessName: merchant.businessName,
      });
      return {
        railId: this.id,
        instructionType: "dva",
        providerRef: dva.providerRef,
        amount: order.amount,
        accountNumber: dva.accountNumber,
        bankName: dva.bankName,
        accountName: dva.accountName,
      };
    }
    // --- live ---
    // No-custody guarantee: the DVA MUST carry the merchant's subaccount so
    // funds settle merchant-direct. Refuse to issue one otherwise.
    if (!merchant.processorSubaccountCode) {
      throw new AppError(
        "merchant has no processor subaccount — cannot settle merchant-direct",
        "missing_subaccount",
        409,
        { merchantId: merchant.id },
      );
    }

    // 1) Create (or reactivate) a Paystack customer for the BUYER. DVAs are
    //    per-customer on Paystack; buyerRef is our stable buyer id. Paystack
    //    requires a syntactically valid email with a REAL TLD (it rejects
    //    .local), and is keyed on email — so we derive a stable, unique address.
    const emailLocal = order.buyerRef.replace(/[^a-zA-Z0-9]/g, "");
    const customerRes = await this.api("/customer", {
      method: "POST",
      body: JSON.stringify({
        email: `buyer-${emailLocal}@buyers.rhodium.africa`,
        first_name: "Rhodium",
        last_name: "Buyer",
      }),
    });
    const customerCode = (customerRes.data as { customer_code: string }).customer_code;

    // 2) Assign a dedicated account, split to the merchant's subaccount.
    const res = await this.api("/dedicated_account/assign", {
      method: "POST",
      body: JSON.stringify({
        customer: customerCode,
        preferred_bank: "wema-bank",
        subaccount: merchant.processorSubaccountCode,
        country: "NG",
      }),
    });
    const data = res.data as {
      account_number: string;
      bank: { name: string };
      account_name: string;
    };
    return {
      railId: this.id,
      instructionType: "dva",
      // The account number is the stable match key the webhook echoes back.
      providerRef: data.account_number,
      amount: order.amount,
      accountNumber: data.account_number,
      bankName: data.bank.name,
      accountName: data.account_name,
    };
  }

  async handleWebhook(raw: WebhookPayload): Promise<PaymentEvent> {
    const sig = raw.headers["x-paystack-signature"];
    if (!this.verifySignature(raw.rawBody, sig)) {
      throw new AppError("invalid webhook signature", "bad_signature", 401);
    }
    const body = JSON.parse(raw.rawBody) as {
      event: string;
      data: {
        id?: string | number;
        reference: string;
        amount: number;
        status: string;
        authorization?: { receiver_bank_account_number?: string; channel?: string };
      };
    };

    // Match key: for a DVA transfer the funds arrive at
    // data.authorization.receiver_bank_account_number (the account we issued).
    // Fall back to data.reference so the in-process mock also flows through.
    const matchRef =
      body.data.authorization?.receiver_bank_account_number ?? body.data.reference;
    // Idempotency is keyed on the per-charge id/reference (stable, unique per
    // transfer) — NOT the account number, which is reused across orders.
    const eventId = body.data.id ?? body.data.reference;

    if (body.event !== "charge.success" || body.data.status !== "success") {
      return {
        railId: this.id,
        providerRef: matchRef ?? "unknown",
        status: "ignored",
        idempotencyKey: `paystack:${eventId}:${body.event}`,
      };
    }

    return {
      railId: this.id,
      providerRef: matchRef,
      status: "confirmed",
      amount: body.data.amount, // Paystack sends kobo
      idempotencyKey: `paystack:${eventId}:charge.success`,
      rawEventId: String(eventId),
    };
  }

  async verifyPayment(providerRef: string): Promise<PaymentStatusResult> {
    if (this.cfg.mode === "mock") {
      const acct = this.mock!.getAccount(providerRef);
      if (!acct) return { providerRef, status: "pending" };
      return {
        providerRef,
        status: acct.status === "success" ? "confirmed" : "pending",
        amount: acct.amount,
      };
    }
    const res = await this.api(
      `/transaction/verify/${encodeURIComponent(providerRef)}`,
      { method: "GET" },
    );
    const data = res.data as { status: string; amount: number };
    return {
      providerRef,
      status: data.status === "success" ? "confirmed" : "pending",
      amount: data.amount,
    };
  }

  private verifySignature(rawBody: string, sig: string | undefined): boolean {
    if (!sig) return false;
    const expected = createHmac("sha512", this.signingSecret)
      .update(rawBody)
      .digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async api(
    path: string,
    init: RequestInit,
  ): Promise<{ status: boolean; data: unknown }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.cfg.secretKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      log.error({ path, status: res.status, text }, "paystack api error");
      throw new AppError(`paystack api ${res.status}`, "provider_error", 502);
    }
    return (await res.json()) as { status: boolean; data: unknown };
  }
}
