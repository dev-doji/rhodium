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
import { MockMonnifyServer } from "./mock-monnify-server.js";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

const log = logger("monnify-rail");

interface MonnifyConfig {
  mode: "mock" | "live";
  apiKey: string;
  secretKey: string;
  contractCode: string;
  baseUrl: string;
  walletAccountNumber: string;
}

/**
 * Bank rail via Monnify — same PaymentRail interface as Paystack. `mock` mode
 * drives an in-process simulator (no credentials); `live` mode authenticates
 * (Basic apiKey:secretKey → bearer) and creates reserved accounts. Funds settle
 * to the merchant's Monnify wallet/bank — Rhodium never holds them.
 * Live specifics marked [VALIDATE] against Monnify's dashboard/docs.
 */
export class MonnifyFiatRail implements PaymentRail {
  readonly id: RailId = "monnify";
  readonly kind = "fiat" as const;
  readonly mock?: MockMonnifyServer;
  private token?: { value: string; expiresAt: number };

  constructor(private cfg: MonnifyConfig) {
    if (cfg.mode === "mock") this.mock = new MockMonnifyServer(cfg.secretKey || "mock-secret");
  }

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
      const acct = this.mock!.createReservedAccount({
        orderId: order.id,
        amount: order.amount,
        businessName: merchant.businessName,
      });
      return {
        railId: this.id,
        instructionType: "dva",
        providerRef: order.id, // Monnify echoes this as product.reference
        amount: order.amount,
        accountNumber: acct.accountNumber,
        bankName: acct.bankName,
        accountName: acct.accountName,
      };
    }
    // --- live ---
    const res = await this.api("/api/v2/bank-transfer/reserved-accounts", {
      method: "POST",
      body: JSON.stringify({
        accountReference: order.id,
        accountName: `RHODIUM/${merchant.businessName}`.slice(0, 40),
        currencyCode: "NGN",
        contractCode: this.cfg.contractCode,
        customerEmail: `${order.buyerRef}@buyers.rhodium.africa`,
        customerName: "Rhodium Buyer",
        getAllAvailableBanks: true,
      }),
    });
    const body = (res.responseBody ?? {}) as {
      accounts?: { bankName: string; accountNumber: string; accountName?: string }[];
    };
    const first = body.accounts?.[0];
    return {
      railId: this.id,
      instructionType: "dva",
      providerRef: order.id,
      amount: order.amount,
      accountNumber: first?.accountNumber,
      bankName: first?.bankName,
      accountName: first?.accountName,
    };
  }

  async handleWebhook(raw: WebhookPayload): Promise<PaymentEvent> {
    const sig = raw.headers["monnify-signature"];
    if (!this.verifySignature(raw.rawBody, sig)) {
      throw new AppError("invalid monnify signature", "bad_signature", 401);
    }
    const body = JSON.parse(raw.rawBody) as {
      eventType: string;
      eventData: {
        transactionReference: string;
        paymentReference?: string;
        amountPaid: string; // naira string
        paymentStatus: string;
        product?: { reference?: string };
      };
    };
    const data = body.eventData;
    const providerRef = data.product?.reference ?? data.paymentReference ?? "unknown";
    const eventId = data.transactionReference;

    if (body.eventType !== "SUCCESSFUL_TRANSACTION" || data.paymentStatus !== "PAID") {
      return { railId: this.id, providerRef, status: "ignored", idempotencyKey: `monnify:${eventId}:${body.eventType}` };
    }
    return {
      railId: this.id,
      providerRef,
      status: "confirmed",
      amount: Math.round(Number(data.amountPaid) * 100), // naira → kobo
      idempotencyKey: `monnify:${eventId}`,
      rawEventId: eventId,
    };
  }

  async verifyPayment(providerRef: string): Promise<PaymentStatusResult> {
    if (this.cfg.mode === "mock") {
      const acct = this.mock!.getByReference(providerRef);
      if (!acct) return { providerRef, status: "pending" };
      return { providerRef, status: acct.status === "paid" ? "confirmed" : "pending", amount: acct.amount };
    }
    // Live: query transaction status by reference. [VALIDATE] exact endpoint.
    const res = await this.api(
      `/api/v1/merchant/transactions/query?paymentReference=${encodeURIComponent(providerRef)}`,
      { method: "GET" },
    ).catch(() => null);
    const status = (res?.responseBody as { paymentStatus?: string } | undefined)?.paymentStatus;
    return { providerRef, status: status === "PAID" ? "confirmed" : "pending" };
  }

  private verifySignature(rawBody: string, sig: string | undefined): boolean {
    if (!sig) return false;
    const secret = this.cfg.secretKey || "mock-secret";
    const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Authenticated Monnify API call (auto-logs in + caches the bearer token). */
  private async api(path: string, init: RequestInit): Promise<{ requestSuccessful: boolean; responseBody: unknown }> {
    const token = await this.auth();
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      log.error({ path, status: res.status, text: await res.text() }, "monnify api error");
      throw new AppError(`monnify api ${res.status}`, "provider_error", 502);
    }
    return (await res.json()) as { requestSuccessful: boolean; responseBody: unknown };
  }

  private async auth(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const basic = Buffer.from(`${this.cfg.apiKey}:${this.cfg.secretKey}`).toString("base64");
    const res = await fetch(`${this.cfg.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new AppError(`monnify auth ${res.status}`, "provider_error", 502);
    const body = (await res.json()) as { responseBody?: { accessToken: string; expiresIn: number } };
    const at = body.responseBody?.accessToken;
    if (!at) throw new AppError("monnify auth: no token", "provider_error", 502);
    this.token = { value: at, expiresAt: Date.now() + (body.responseBody!.expiresIn - 30) * 1000 };
    return at;
  }
}
