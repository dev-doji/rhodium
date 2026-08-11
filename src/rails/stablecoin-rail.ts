import type {
  PaymentRail,
  PaymentInstruction,
  PaymentEvent,
  PaymentStatusResult,
  WebhookPayload,
  SettlementTarget,
} from "./types.js";
import type { Merchant, Order, RailId } from "../domain/types.js";
import { FeatureDisabledError } from "../lib/errors.js";

/**
 * Stablecoin rail — BUILT but DARK (§1.4, §2.1). It implements the interface so
 * the seam exists from day one, but every method refuses while the feature flag
 * is OFF. Flesh out on testnet only when a real cross-border merchant asks, and
 * only after [LEGAL] confirms VASP classification.
 *
 * Design (deferred): unique deposit address (crypto twin of the DVA); provider
 * settles MERCHANT-DIRECT (USDC to merchant wallet, or auto-convert to NGN into
 * the merchant's bank). We never custody crypto or run FX.
 */
export class StablecoinRail implements PaymentRail {
  readonly id: RailId = "stablecoin_base";
  readonly kind = "crypto" as const;

  constructor(private enabled: boolean) {}

  private guard(): void {
    if (!this.enabled) throw new FeatureDisabledError("stablecoin_rail");
  }

  settlementTarget(merchant: Merchant): SettlementTarget {
    return {
      kind: "wallet",
      walletAddress: undefined, // merchant's wallet, set at enablement
      owner: "merchant",
    };
  }

  async createPaymentInstruction(
    _order: Order,
    _merchant: Merchant,
  ): Promise<PaymentInstruction> {
    this.guard();
    throw new FeatureDisabledError("stablecoin_rail"); // unreachable while dark
  }

  async handleWebhook(_raw: WebhookPayload): Promise<PaymentEvent> {
    this.guard();
    throw new FeatureDisabledError("stablecoin_rail");
  }

  async verifyPayment(_ref: string): Promise<PaymentStatusResult> {
    this.guard();
    throw new FeatureDisabledError("stablecoin_rail");
  }
}
