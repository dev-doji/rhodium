import type { Kobo } from "../lib/money.js";

// ---------------------------------------------------------------------------
// Core data model (MVP) — §2.4 of the TRD.
// ---------------------------------------------------------------------------

export type RailKind = "fiat" | "crypto";
export type RailId = "monnify" | "paystack" | "stablecoin_base" | "quai" | "onswitch";

export type MerchantStatus = "pending" | "active" | "suspended";
export type KycState = "unverified" | "pending" | "verified" | "rejected";

export interface Merchant {
  id: string;
  phone: string; // E.164, stored encrypted at rest
  businessName: string;
  status: MerchantStatus;
  kycState: KycState;
  cryptoEnabled: boolean; // per-merchant dark flag for the stablecoin rail
  /** Where fiat settles — the MERCHANT's own bank account. Never us. */
  settlementBankCode?: string;
  settlementAccountNumber?: string; // encrypted at rest
  /**
   * Processor subaccount/split code created at onboarding so DVA funds settle
   * MERCHANT-DIRECT (no custody). Required to issue a live DVA — see
   * PaystackFiatRail.createPaymentInstruction.
   */
  processorSubaccountCode?: string;
  /** Merchant's self-custody Quai wallet — where crypto sales settle (no custody by us). */
  quaiAddress?: string;
  /** Human-readable buyer-link handle, e.g. "circuitcity" → `shop-circuitcity`. */
  slug?: string;
  /**
   * The vendor's OWN WhatsApp Cloud API number, connected through Embedded
   * Signup. Everything multi-tenant keys off `waPhoneNumberId` (a Meta id):
   * inbound webhooks carry it in `value.metadata.phone_number_id`, and outbound
   * sends POST to `/{waPhoneNumberId}/messages`. Absent => this merchant is
   * served from Rhodium's own number.
   */
  waPhoneNumberId?: string;
  waBusinessAccountId?: string;
  /** Display form of that number, used to build buyer `wa.me` links. */
  waDisplayPhone?: string;
  createdAt: Date;
}

export interface Product {
  id: string;
  merchantId: string;
  name: string;
  price: Kobo;
  imageUrl?: string;
  stockQty?: number; // undefined => untracked stock
  createdAt: Date;
}

export interface OrderItem {
  productId: string;
  name: string;
  unitPrice: Kobo;
  qty: number;
}

export type OrderStatus =
  | "draft"
  | "awaiting_payment"
  | "paid"
  | "fulfilled"
  | "cancelled"
  | "expired";

export interface Order {
  id: string;
  merchantId: string;
  buyerRef: string; // buyer.id or a raw phone/ref
  items: OrderItem[];
  amount: Kobo;
  rail: RailKind;
  status: OrderStatus;
  createdAt: Date;
  expiresAt?: Date;
}

export type InstructionType = "dva" | "link" | "crypto";
export type PaymentStatus =
  | "pending"
  | "confirmed"
  | "failed"
  | "expired";

export interface Payment {
  id: string;
  orderId: string;
  railId: RailId;
  providerRef: string; // provider's id / DVA account or link ref
  instructionType: InstructionType;
  amount: Kobo;
  status: PaymentStatus;
  confirmedAt?: Date;
  /**
   * The instruction as the provider issued it, serialised. Re-issuing a DVA
   * has side effects, so the checkout page must re-read this rather than ask
   * the provider again.
   */
  instructionJson?: string;
  createdAt: Date;
}

export type LedgerEntryType = "sale" | "refund" | "adjustment";

/** Append-only. Never updated or deleted. §2.4 */
export interface LedgerEntry {
  id: string;
  merchantId: string;
  orderId: string;
  paymentId: string;
  type: LedgerEntryType;
  amount: Kobo; // signed: sale positive, refund negative
  balanceAfter: Kobo;
  createdAt: Date;
}

export interface Buyer {
  id: string;
  merchantId: string;
  phoneOrRef: string; // encrypted at rest
  name?: string;
  firstSeen: Date;
  orderCount: number;
}
