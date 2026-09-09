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
/**
 * Assets a browser wallet can pay directly, and what it needs to do so.
 *
 * Deliberately short. An entry here means the checkout will ask MetaMask to
 * move real money to a contract address, so every one was verified on its own
 * chain — symbol() and decimals() read live — rather than copied from a list.
 * A wrong address here does not fail loudly; it sends a buyer's money to
 * something that is not the token they think it is.
 *
 * Anything absent still works: the buyer copies the deposit address and pays
 * from wherever they like. Tron and Solana belong in that group permanently,
 * because no EVM wallet can send them.
 */
const PAYABLE_FROM_WALLET: Record<
  string,
  { chainId: number; tokenAddress: string; decimals: number }
> = {
  // Verified on Arbitrum One: symbol USDC, decimals 6.
  "arbitrum:usdc": {
    chainId: 42161,
    tokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    decimals: 6,
  },
  // Verified on Arbitrum One: symbol USD₮0, decimals 6. Tether's own Arbitrum
  // deployment renamed itself; the address is what matters.
  "arbitrum:usdt": {
    chainId: 42161,
    tokenAddress: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    decimals: 6,
  },
};

/**
 * A business name OnSwitch's validator will accept.
 *
 * It rejects anything that is not alphanumeric, requires at least one letter,
 * and refuses "crypto related terms" — observed live, as:
 *
 *   "Name can only contain alphanumeric characters, must contain at least one
 *    letter, should not contain crypto related terms."
 *
 * Merchants name their shops "Tee's Kitchen", "A&B Stores", "Mama-Put Foods".
 * Sent raw, those are refused and the buyer sees a 422 they cannot act on,
 * for a shop that is perfectly legitimate. Punctuation is dropped rather than
 * replaced, so "Tee's Kitchen" becomes "Tees Kitchen" — still recognisable on
 * a bank statement, which is the point of the field.
 */
export function bankSafeName(raw: string): string {
  const cleaned = (raw ?? "")
    .replace(/[^A-Za-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  // Must contain a letter. A shop called "123" would otherwise be refused with
  // a message about letters that names nothing the merchant can change.
  return /[A-Za-z]/.test(cleaned) ? cleaned : "Merchant";
}

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
          holder_name: bankSafeName(merchant.businessName),
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
    // GET /payment/status?reference=..., NOT /offramp/{ref}.
    //
    // This called /offramp/{ref}, which OnSwitch answers with 404 "Resource
    // does not exist" — verified against their API. The .catch below turned
    // that into "pending", so the poll fallback silently never worked: the
    // "I've sent it — check now" button could only ever say "not showing yet",
    // and reconciliation could never confirm an off-ramp the webhook missed.
    // A safety net that always reports nothing is worse than none, because it
    // is believed.
    const res = await this.api(
      `/payment/status?reference=${encodeURIComponent(providerRef)}`,
      { method: "GET" },
    ).catch(() => null);
    const data = (res as { data?: { status?: string; destination?: { amount?: number } } } | null)?.data;
    const status = data?.status;
    // FAILED / REVERSED / BLOCKED are terminal and must not read as "still
    // waiting" — a buyer told to keep waiting for a payment that was reversed
    // is being misled.
    if (status === "FAILED" || status === "REVERSED" || status === "BLOCKED") {
      return { providerRef, status: "failed" };
    }
    return { providerRef, status: status === "COMPLETED" ? "confirmed" : "pending" };
  }

  private instruction(order: Order, reference: string, address: string, amount: number, asset: string): PaymentInstruction {
    const [network, token] = asset.split(":");
    // Live only. A mock deposit address is "0x" + random hex — it belongs to
    // nobody and nothing watches it. Attaching a real chain id and Circle's
    // real USDC contract to that would put a "Pay from my wallet" button in
    // front of a buyer that moves REAL mainnet money into a void. The rest of
    // the mock instruction is harmless; this part is not.
    const payable = this.cfg.mode === "live" ? PAYABLE_FROM_WALLET[asset.toLowerCase()] : undefined;
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
      // Present only for assets a browser wallet can actually pay. Without
      // these the checkout offers "copy the address" alone, which is right for
      // Tron and Solana — MetaMask cannot send those at all.
      ...(payable
        ? {
            walletChainId: payable.chainId,
            tokenAddress: payable.tokenAddress,
            tokenDecimals: payable.decimals,
          }
        : {}),
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
