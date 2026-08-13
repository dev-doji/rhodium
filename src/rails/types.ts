import type {
  Merchant,
  Order,
  Payment,
  RailId,
  RailKind,
  InstructionType,
} from "../domain/types.js";
import type { Kobo } from "../lib/money.js";

/** Where funds settle. RULE (§2.5): the target is the MERCHANT — never us. */
export interface SettlementTarget {
  kind: "bank_account" | "wallet";
  bankCode?: string;
  accountNumber?: string; // merchant's account
  walletAddress?: string; // for crypto rail
  owner: "merchant";
}

/** What the buyer is told in-chat to pay to (a DVA, or a checkout link). */
export interface PaymentInstruction {
  railId: RailId;
  instructionType: InstructionType;
  providerRef: string;
  amount: Kobo;
  // DVA specifics
  accountNumber?: string;
  bankName?: string;
  accountName?: string;
  // link specifics
  checkoutUrl?: string;
  expiresAt?: Date;
  // crypto specifics (Quai / BlipPay)
  chainId?: string;
  contractAddress?: string;
  method?: "payNative" | "payToken";
  tokenAddress?: string; // ERC-20 (USDT); omitted for native QUAI
  tokenSymbol?: string;
  cryptoAmount?: string; // token base units / wei (string to avoid float/BigInt json issues)
  merchantAddress?: string;
  orderIdBytes32?: string; // keccak(orderId) — the contract call arg + event match key
  deepLink?: string; // blip://browser?url=... to open checkout inside BlipPay
  // off-ramp specifics (OnSwitch): buyer sends stablecoin to a deposit address,
  // merchant is paid naira to their bank.
  depositAddress?: string;
  network?: string; // e.g. "base", "tron"
  settlesToNaira?: boolean;
}

/** Normalised result of interpreting a provider webhook. */
export interface PaymentEvent {
  railId: RailId;
  providerRef: string;
  status: "confirmed" | "failed" | "ignored";
  amount?: Kobo;
  /** Stable idempotency key derived from the provider's event identity. */
  idempotencyKey: string;
  rawEventId?: string;
}

export interface PaymentStatusResult {
  providerRef: string;
  status: "pending" | "confirmed" | "failed";
  amount?: Kobo;
}

export interface WebhookPayload {
  headers: Record<string, string | undefined>;
  rawBody: string; // exact bytes as received — needed for signature verification
}

/**
 * The spine (§2.3). Build this FIRST. Every rail — fiat today, stablecoin and
 * credit later — implements exactly this. Rail specifics never leak past it.
 */
export interface PaymentRail {
  readonly id: RailId;
  readonly kind: RailKind;

  createPaymentInstruction(
    order: Order,
    merchant: Merchant,
  ): Promise<PaymentInstruction>;

  /** Idempotent: same webhook replayed => same PaymentEvent, one side effect. */
  handleWebhook(raw: WebhookPayload): Promise<PaymentEvent>;

  /** Poll fallback for missed webhooks. */
  verifyPayment(providerRef: string): Promise<PaymentStatusResult>;

  settlementTarget(merchant: Merchant): SettlementTarget;
}

export type { Payment };
