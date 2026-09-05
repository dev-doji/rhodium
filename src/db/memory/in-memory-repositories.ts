import type {
  Merchant,
  Product,
  Order,
  OrderStatus,
  Payment,
  PaymentStatus,
  LedgerEntry,
  Buyer,
} from "../../domain/types.js";
import type {
  Repositories,
  MerchantRepo,
  ProductRepo,
  OrderRepo,
  PaymentRepo,
  LedgerRepo,
  BuyerRepo,
  AppendLedgerInput,
} from "../repositories.js";
import type { Clock } from "../../lib/clock.js";
import { systemClock } from "../../lib/clock.js";
import { id } from "../../lib/ids.js";
import { NotFoundError } from "../../lib/errors.js";
import { normalisePhone } from "../../lib/phone.js";
import type { Kobo } from "../../lib/money.js";

/**
 * In-memory repositories. Behaviour-identical to the Postgres implementation
 * for the domain contract; used by the test suite and the demo so the whole
 * system runs with zero external dependencies.
 */

class MemMerchantRepo implements MerchantRepo {
  private m = new Map<string, Merchant>();
  constructor(private clock: Clock) {}
  async create(input: Omit<Merchant, "createdAt">): Promise<Merchant> {
    const merchant: Merchant = {
      ...input,
      phone: normalisePhone(input.phone) || input.phone,
      createdAt: this.clock.now(),
    };
    this.m.set(merchant.id, merchant);
    return merchant;
  }
  async byId(id: string): Promise<Merchant | null> {
    return this.m.get(id) ?? null;
  }
  async byPhone(phone: string): Promise<Merchant | null> {
    const wanted = normalisePhone(phone) || phone;
    for (const m of this.m.values()) if (m.phone === wanted) return m;
    for (const m of this.m.values()) if (m.phone === phone) return m; // legacy rows
    return null;
  }
  async byWaPhoneNumberId(waPhoneNumberId: string): Promise<Merchant | null> {
    if (!waPhoneNumberId) return null;
    for (const m of this.m.values()) if (m.waPhoneNumberId === waPhoneNumberId) return m;
    return null;
  }
  async bySlug(slug: string): Promise<Merchant | null> {
    if (!slug) return null;
    const wanted = slug.toLowerCase();
    for (const m of this.m.values()) if (m.slug?.toLowerCase() === wanted) return m;
    return null;
  }
  async update(id: string, patch: Partial<Merchant>): Promise<Merchant> {
    const cur = this.m.get(id);
    if (!cur) throw new NotFoundError("merchant", { id });
    const next = { ...cur, ...patch, id: cur.id };
    // Mirror the Postgres semantics: an empty string clears the field. The two
    // implementations must agree or a test passes while production does not.
    for (const k of [
      "processorSubaccountCode",
      "cryptoSettlement",
      "slug",
      "waPhoneNumberId",
      "waBusinessAccountId",
      "waDisplayPhone",
    ] as const) {
      if (next[k] === "") delete next[k];
    }
    this.m.set(id, next);
    return next;
  }
  async list(): Promise<Merchant[]> {
    return [...this.m.values()];
  }
  private secrets = new Map<string, { mnemonic: string; privateKey: string }>();
  async setWalletSecrets(merchantId: string, mnemonic: string, privateKey: string): Promise<void> {
    this.secrets.set(merchantId, { mnemonic, privateKey });
  }
  async getWalletSecrets(merchantId: string): Promise<{ mnemonic: string; privateKey: string } | null> {
    return this.secrets.get(merchantId) ?? null;
  }
}

class MemProductRepo implements ProductRepo {
  private p = new Map<string, Product>();
  constructor(private clock: Clock) {}
  async create(input: Omit<Product, "createdAt">): Promise<Product> {
    const product: Product = { ...input, createdAt: this.clock.now() };
    this.p.set(product.id, product);
    return product;
  }
  async byId(id: string): Promise<Product | null> {
    return this.p.get(id) ?? null;
  }
  async listByMerchant(merchantId: string): Promise<Product[]> {
    return [...this.p.values()].filter((x) => x.merchantId === merchantId);
  }
  async update(id: string, patch: Partial<Product>): Promise<Product> {
    const cur = this.p.get(id);
    if (!cur) throw new NotFoundError("product", { id });
    const next = { ...cur, ...patch, id: cur.id };
    this.p.set(id, next);
    return next;
  }
  async decrementStock(id: string, qty: number): Promise<void> {
    const cur = this.p.get(id);
    if (!cur) throw new NotFoundError("product", { id });
    if (cur.stockQty == null) return; // untracked
    this.p.set(id, { ...cur, stockQty: Math.max(0, cur.stockQty - qty) });
  }
}

class MemOrderRepo implements OrderRepo {
  private o = new Map<string, Order>();
  constructor(private clock: Clock) {}
  async create(input: Omit<Order, "createdAt">): Promise<Order> {
    const order: Order = { ...input, createdAt: this.clock.now() };
    this.o.set(order.id, order);
    return order;
  }
  async byId(id: string): Promise<Order | null> {
    return this.o.get(id) ?? null;
  }
  async listByMerchant(merchantId: string): Promise<Order[]> {
    return [...this.o.values()].filter((x) => x.merchantId === merchantId);
  }
  async updateStatus(id: string, status: OrderStatus): Promise<Order> {
    const cur = this.o.get(id);
    if (!cur) throw new NotFoundError("order", { id });
    const next = { ...cur, status };
    this.o.set(id, next);
    return next;
  }
}

class MemPaymentRepo implements PaymentRepo {
  private p = new Map<string, Payment>();
  constructor(private clock: Clock) {}
  async create(input: Omit<Payment, "createdAt">): Promise<Payment> {
    const payment: Payment = { ...input, createdAt: this.clock.now() };
    this.p.set(payment.id, payment);
    return payment;
  }
  async byId(id: string): Promise<Payment | null> {
    return this.p.get(id) ?? null;
  }
  async byOrderId(orderId: string): Promise<Payment | null> {
    for (const p of this.p.values()) if (p.orderId === orderId) return p;
    return null;
  }
  async byProviderRef(providerRef: string): Promise<Payment | null> {
    for (const p of this.p.values())
      if (p.providerRef === providerRef) return p;
    return null;
  }
  async findPendingByProviderRef(providerRef: string): Promise<Payment | null> {
    const pending = [...this.p.values()]
      .filter((p) => p.providerRef === providerRef && p.status === "pending")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return pending[0] ?? null;
  }
  async markConfirmed(id: string, confirmedAt: Date): Promise<Payment> {
    return this.updateInternal(id, { status: "confirmed", confirmedAt });
  }
  async updateStatus(id: string, status: PaymentStatus): Promise<Payment> {
    return this.updateInternal(id, { status });
  }
  private async updateInternal(
    id: string,
    patch: Partial<Payment>,
  ): Promise<Payment> {
    const cur = this.p.get(id);
    if (!cur) throw new NotFoundError("payment", { id });
    const next = { ...cur, ...patch, id: cur.id };
    this.p.set(id, next);
    return next;
  }
  async all(): Promise<Payment[]> {
    return [...this.p.values()];
  }
}

class MemLedgerRepo implements LedgerRepo {
  private entries: LedgerEntry[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private clock: Clock) {}

  /** Serialize appends so balanceAfter is always computed from a settled state. */
  async append(input: AppendLedgerInput): Promise<LedgerEntry> {
    const run = this.tail.then(() => this.doAppend(input));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async doAppend(input: AppendLedgerInput): Promise<LedgerEntry> {
    const prev = await this.balance(input.merchantId);
    const entry: LedgerEntry = {
      id: id("led"),
      merchantId: input.merchantId,
      orderId: input.orderId,
      paymentId: input.paymentId,
      type: input.type,
      amount: input.amount,
      balanceAfter: prev + input.amount,
      createdAt: this.clock.now(),
    };
    this.entries.push(entry); // append-only, never mutated
    return entry;
  }

  async listByMerchant(merchantId: string): Promise<LedgerEntry[]> {
    return this.entries.filter((e) => e.merchantId === merchantId);
  }
  async balance(merchantId: string): Promise<Kobo> {
    return this.entries
      .filter((e) => e.merchantId === merchantId)
      .reduce((acc, e) => acc + e.amount, 0);
  }
  async sumByMerchant(merchantId: string): Promise<Kobo> {
    return this.entries
      .filter((e) => e.merchantId === merchantId && e.type === "sale")
      .reduce((acc, e) => acc + e.amount, 0);
  }
}

class MemBuyerRepo implements BuyerRepo {
  private b = new Map<string, Buyer>();
  constructor(private clock: Clock) {}
  async upsert(
    merchantId: string,
    phoneOrRef: string,
    name?: string,
  ): Promise<Buyer> {
    for (const buyer of this.b.values()) {
      if (buyer.merchantId === merchantId && buyer.phoneOrRef === phoneOrRef) {
        if (name && !buyer.name) buyer.name = name;
        return buyer;
      }
    }
    const buyer: Buyer = {
      id: id("buy"),
      merchantId,
      phoneOrRef,
      name,
      firstSeen: this.clock.now(),
      orderCount: 0,
    };
    this.b.set(buyer.id, buyer);
    return buyer;
  }
  async byId(id: string): Promise<Buyer | null> {
    return this.b.get(id) ?? null;
  }
  async listByMerchant(merchantId: string): Promise<Buyer[]> {
    return [...this.b.values()].filter((x) => x.merchantId === merchantId);
  }
  async incrementOrderCount(id: string): Promise<void> {
    const cur = this.b.get(id);
    if (cur) cur.orderCount += 1;
  }
}

export function createInMemoryRepositories(
  clock: Clock = systemClock,
): Repositories {
  return {
    merchants: new MemMerchantRepo(clock),
    products: new MemProductRepo(clock),
    orders: new MemOrderRepo(clock),
    payments: new MemPaymentRepo(clock),
    ledger: new MemLedgerRepo(clock),
    buyers: new MemBuyerRepo(clock),
  };
}
