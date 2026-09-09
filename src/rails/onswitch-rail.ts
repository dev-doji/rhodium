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
import { MockOnSwitchServer } from "./mock-onswitch-server.js";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { bankCodeFor } from "../modules/whatsapp/banks.js";

const log = logger("onswitch-rail");

interface OnSwitchConfig {
  mode: "mock" | "live";
  serviceKey: string;
  baseUrl: string;
  asset: string; // "chain:token", e.g. base:usdc
  callbackUrl: string; // {publicBaseUrl}/webhooks/rails/onswitch
}

/**
 * OnSwitch crypto→naira off-ramp rail. The BUYER pays a stablecoin (USDT/USDC)
 * to a deposit address; OnSwitch converts and settles NAIRA to the MERCHANT's
 * bank account. Same PaymentRail interface — the order is priced in naira, the
 * ledger records naira; only the buyer's payment asset differs.
 */
export class OnSwitchRail implements PaymentRail {
  readonly id: RailId = "onswitch";
  readonly kind = "crypto" as const;
  readonly mock?: MockOnSwitchServer;

  constructor(private cfg: OnSwitchConfig) {
    if (cfg.mode === "mock") this.mock = new MockOnSwitchServer(cfg.serviceKey || "mock-key", cfg.asset);
  }

  settlementTarget(merchant: Merchant): SettlementTarget {
    // Settles NAIRA to the merchant's bank — never us.
    return {
      kind: "bank_account",
      bankCode: merchant.settlementBankCode,
      accountNumber: merchant.settlementAccountNumber,
      owner: "merchant",
    };
  }

  async createPaymentInstruction(order: Order, merchant: Merchant): Promise<PaymentInstruction> {
    if (!merchant.settlementBankCode || !merchant.settlementAccountNumber) {
      throw new AppError(
        "merchant has no bank account — cannot settle the off-ramp in naira",
        "missing_bank",
        409,
        { merchantId: merchant.id },
      );
    }
    const naira = order.amount / 100;

    if (this.cfg.mode === "mock") {
      const o = this.mock!.initiate({ orderId: order.id, nairaKobo: order.amount });
      return this.instruction(order, o.reference, o.depositAddress, o.depositAmount, o.asset);
    }

    // --- live ---
    const res = await this.api("/offramp/initiate", {
      method: "POST",
      body: JSON.stringify({
        amount: naira,
        exact_output: true, // amount is the NAIRA the merchant receives; OnSwitch computes the crypto
        country: "NG",
        currency: "NGN",
        channel: "BANK",
        asset: this.cfg.asset,
        sender_name: "Rhodium Buyer",
        narration: `Order ${order.id.slice(-6).toUpperCase()}`,
        callback_url: this.cfg.callbackUrl,
        beneficiary: {
          holder_type: "BUSINESS",
          holder_name: merchant.businessName.slice(0, 60),
          account_number: merchant.settlementAccountNumber,
          bank_code: bankCodeFor("nibss", merchant.settlementBankCode),
        },
      }),
    });
    const data = (res as { data: { reference: string; deposit: { address: string; amount: number; asset: string } } }).data;
    return this.instruction(order, data.reference, data.deposit.address, data.deposit.amount, data.deposit.asset);
  }

  async handleWebhook(raw: WebhookPayload): Promise<PaymentEvent> {
    const sig = raw.headers["x-switch-signature"];
    if (!this.verifySignature(raw.rawBody, sig, raw.headers)) {
      throw new AppError("invalid onswitch signature", "bad_signature", 401);
    }
    const body = JSON.parse(raw.rawBody) as {
      data: {
        status: string;
        reference: string;
        destination?: { amount: number; currency: string };
      };
    };
    const d = body.data;
    if (d.status !== "COMPLETED") {
      return { railId: this.id, providerRef: d.reference, status: "ignored", idempotencyKey: `onswitch:${d.reference}:${d.status}` };
    }
    log.info({ reference: d.reference }, "onswitch settlement completed");
    return {
      railId: this.id,
      providerRef: d.reference,
      status: "confirmed",
      amount: Math.round((d.destination?.amount ?? 0) * 100), // naira → kobo
      idempotencyKey: `onswitch:${d.reference}`,
      rawEventId: d.reference,
    };
  }

  async verifyPayment(providerRef: string): Promise<PaymentStatusResult> {
    if (this.cfg.mode === "mock") {
      const o = this.mock!.getByReference(providerRef);
      if (!o) return { providerRef, status: "pending" };
      return { providerRef, status: o.status === "COMPLETED" ? "confirmed" : "pending", amount: o.nairaKobo };
    }
    const res = await this.api(`/offramp/${encodeURIComponent(providerRef)}`, { method: "GET" }).catch(() => null);
    const status = (res as { data?: { status?: string } } | null)?.data?.status;
    return { providerRef, status: status === "COMPLETED" ? "confirmed" : "pending" };
  }

  private instruction(order: Order, reference: string, address: string, amount: number, asset: string): PaymentInstruction {
    const [network, token] = asset.split(":");
    return {
      railId: this.id,
      instructionType: "crypto",
      providerRef: reference,
      amount: order.amount, // naira kobo (what the merchant is credited)
      depositAddress: address,
      cryptoAmount: String(amount),
      tokenSymbol: (token ?? "USDC").toUpperCase(),
      network: network ?? "base",
      settlesToNaira: true,
    };
  }

  /**
   * Check OnSwitch's webhook signature.
   *
   * NOTE: this scheme — HMAC-SHA256 of the raw body with the service key, hex,
   * under `x-switch-signature` — is our assumption. Nothing here cites
   * OnSwitch's documentation for it, and the mock signs exactly the way this
   * verifies, so the tests are a closed loop that proves the logic and nothing
   * about the provider.
   *
   * If the real scheme differs, a genuine settlement webhook is rejected as a
   * forgery. That is recoverable — verifyPayment polls GET /offramp/{ref},
   * which needs no signature, and /api/checkout/:orderId/verify triggers it —
   * but only if someone can SEE it happened. Hence the diagnostic below: the
   * first real webhook that fails tells us which header they actually sent and
   * how long their digest is, which is usually enough to identify the scheme.
   *
   * Header names and digest lengths only. The service key never appears, and
   * an HMAC digest does not reveal the key that produced it.
   */
  private verifySignature(
    rawBody: string,
    sig: string | undefined,
    headers?: Record<string, string | undefined>,
  ): boolean {
    const expected = createHmac("sha256", this.cfg.serviceKey || "mock-key").update(rawBody).digest("hex");
    if (!sig) {
      log.error(
        { headerNames: Object.keys(headers ?? {}), expectedLength: expected.length },
        "onswitch webhook carried no x-switch-signature — if one of these header " +
          "names is theirs, the scheme differs from what this rail assumes",
      );
      return false;
    }
    const a = Buffer.from(expected);
    const b = Buffer.from(sig.trim());
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (!ok) {
      log.error(
        { receivedLength: sig.trim().length, expectedLength: expected.length, bodyLength: rawBody.length },
        "onswitch webhook signature did not match. A different LENGTH means a " +
          "different encoding or algorithm, not a forgery — confirm the payment " +
          "with POST /api/checkout/:orderId/verify, which polls instead",
      );
    }
    return ok;
  }

  private async api(path: string, init: RequestInit): Promise<unknown> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      ...init,
      headers: { "x-service-key": this.cfg.serviceKey, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      const text = await res.text();
      log.error({ path, status: res.status, text }, "onswitch api error");
      // Carry OnSwitch's own words, the way the Paystack rail does. "onswitch
      // api 422" is true and useless: a 422 is the provider naming the field
      // it rejected, and discarding that turns a one-line answer into an
      // afternoon of guessing.
      let detail = text.slice(0, 300);
      try {
        const body = JSON.parse(text) as { message?: string; error?: string; errors?: unknown };
        // Validation errors arrive as `errors` — an array of strings, or an
        // object keyed by field name. Flattened so the message names the field
        // either way.
        if (body.errors && typeof body.errors === "object") {
          const entries = Object.entries(body.errors as Record<string, unknown>);
          const isArray = Array.isArray(body.errors);
          const parts = entries.map(([key, value]) => {
            const said = Array.isArray(value) ? value.join(", ") : String(value);
            return isArray ? said : `${key}: ${said}`;
          });
          if (parts.length) detail = parts.join("; ");
        } else if (body.message) {
          detail = body.message;
        } else if (body.error) {
          detail = body.error;
        }
      } catch {
        /* not JSON; the raw text is the best we have */
      }
      throw new AppError(`onswitch ${path} ${res.status}: ${detail}`, "provider_error", 502);
    }
    return res.json();
  }
}
