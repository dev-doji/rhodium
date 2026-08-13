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
          bank_code: merchant.settlementBankCode,
        },
      }),
    });
    const data = (res as { data: { reference: string; deposit: { address: string; amount: number; asset: string } } }).data;
    return this.instruction(order, data.reference, data.deposit.address, data.deposit.amount, data.deposit.asset);
  }

  async handleWebhook(raw: WebhookPayload): Promise<PaymentEvent> {
    const sig = raw.headers["x-switch-signature"];
    if (!this.verifySignature(raw.rawBody, sig)) {
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

  private verifySignature(rawBody: string, sig: string | undefined): boolean {
    if (!sig) return false;
    const expected = createHmac("sha256", this.cfg.serviceKey || "mock-key").update(rawBody).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(sig.trim());
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async api(path: string, init: RequestInit): Promise<unknown> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      ...init,
      headers: { "x-service-key": this.cfg.serviceKey, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      log.error({ path, status: res.status, text: await res.text() }, "onswitch api error");
      throw new AppError(`onswitch api ${res.status}`, "provider_error", 502);
    }
    return res.json();
  }
}
