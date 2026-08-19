import type {
  Merchant,
  Product,
  Order,
  OrderStatus,
  Payment,
  PaymentStatus,
  LedgerEntry,
  LedgerEntryType,
  Buyer,
} from "../domain/types.js";
import type { Kobo } from "../lib/money.js";

/**
 * Repository interfaces. Services depend on these, never on a concrete DB, so
 * the in-memory implementation (tests) and the Prisma/Postgres implementation
 * (prod) are fully interchangeable.
 */

export interface MerchantRepo {
  create(m: Omit<Merchant, "createdAt">): Promise<Merchant>;
  byId(id: string): Promise<Merchant | null>;
  byPhone(phone: string): Promise<Merchant | null>;
  /**
   * Tenant lookup for multi-tenant WhatsApp: which vendor owns the Cloud API
   * number a message arrived on. Keyed by the Meta phone_number_id, never by a
   * phone string.
   */
  byWaPhoneNumberId(waPhoneNumberId: string): Promise<Merchant | null>;
  update(id: string, patch: Partial<Merchant>): Promise<Merchant>;
  list(): Promise<Merchant[]>;
  /**
   * Embedded-wallet secrets, kept OUT of the Merchant object so they never leak
   * through normal reads/logs. Implementations encrypt at rest.
   */
  setWalletSecrets(merchantId: string, mnemonic: string, privateKey: string): Promise<void>;
  getWalletSecrets(merchantId: string): Promise<{ mnemonic: string; privateKey: string } | null>;
}

export interface ProductRepo {
  create(p: Omit<Product, "createdAt">): Promise<Product>;
  byId(id: string): Promise<Product | null>;
  listByMerchant(merchantId: string): Promise<Product[]>;
  update(id: string, patch: Partial<Product>): Promise<Product>;
  decrementStock(id: string, qty: number): Promise<void>;
}

export interface OrderRepo {
  create(o: Omit<Order, "createdAt">): Promise<Order>;
  byId(id: string): Promise<Order | null>;
  listByMerchant(merchantId: string): Promise<Order[]>;
  updateStatus(id: string, status: OrderStatus): Promise<Order>;
}

export interface PaymentRepo {
  create(p: Omit<Payment, "createdAt">): Promise<Payment>;
  byId(id: string): Promise<Payment | null>;
  byOrderId(orderId: string): Promise<Payment | null>;
  byProviderRef(providerRef: string): Promise<Payment | null>;
  /**
   * Oldest still-pending payment for a providerRef. Live Paystack DVAs are
   * per-customer and REUSED across orders, so providerRef (the account number)
   * is not unique — the pending one is the order awaiting this transfer.
   */
  findPendingByProviderRef(providerRef: string): Promise<Payment | null>;
  markConfirmed(id: string, confirmedAt: Date): Promise<Payment>;
  updateStatus(id: string, status: PaymentStatus): Promise<Payment>;
  all(): Promise<Payment[]>;
}

export interface AppendLedgerInput {
  merchantId: string;
  orderId: string;
  paymentId: string;
  type: LedgerEntryType;
  amount: Kobo; // signed
}

export interface LedgerRepo {
  /**
   * ATOMIC append: reads the merchant's current balance and writes a new
   * append-only entry with balanceAfter, in one transaction. This is the
   * ledger-integrity guarantee — concurrent appends never race the balance.
   */
  append(input: AppendLedgerInput): Promise<LedgerEntry>;
  listByMerchant(merchantId: string): Promise<LedgerEntry[]>;
  balance(merchantId: string): Promise<Kobo>;
  sumByMerchant(merchantId: string): Promise<Kobo>;
}

export interface BuyerRepo {
  upsert(
    merchantId: string,
    phoneOrRef: string,
    name?: string,
  ): Promise<Buyer>;
  byId(id: string): Promise<Buyer | null>;
  listByMerchant(merchantId: string): Promise<Buyer[]>;
  incrementOrderCount(id: string): Promise<void>;
}

export interface Repositories {
  merchants: MerchantRepo;
  products: ProductRepo;
  orders: OrderRepo;
  payments: PaymentRepo;
  ledger: LedgerRepo;
  buyers: BuyerRepo;
}
