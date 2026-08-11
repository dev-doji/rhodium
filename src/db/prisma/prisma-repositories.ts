import type { PrismaClient, Prisma } from "@prisma/client";
import type {
  Merchant,
  Product,
  Order,
  OrderStatus,
  OrderItem,
  Payment,
  PaymentStatus,
  LedgerEntry,
  Buyer,
  RailId,
  InstructionType,
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
import { id } from "../../lib/ids.js";
import { NotFoundError } from "../../lib/errors.js";
import { encryptField, decryptField } from "../../lib/crypto.js";
import { blindIndex } from "../../lib/pii.js";
import type { Kobo } from "../../lib/money.js";

/**
 * Postgres repositories via Prisma. PII (phone, settlement account) is stored
 * ENCRYPTED with a blind-index hash for equality lookups. The ledger append is
 * done inside a serializable transaction so balanceAfter can never race.
 */

type Row = Record<string, unknown>;

class PgMerchantRepo implements MerchantRepo {
  constructor(private db: PrismaClient) {}
  async create(m: Omit<Merchant, "createdAt">): Promise<Merchant> {
    const row = await this.db.merchant.create({
      data: {
        id: m.id,
        phoneEnc: encryptField(m.phone),
        phoneHash: blindIndex(m.phone),
        businessName: m.businessName,
        status: m.status,
        kycState: m.kycState,
        cryptoEnabled: m.cryptoEnabled,
        settlementBankCode: m.settlementBankCode ?? null,
        settlementAccountEnc: m.settlementAccountNumber
          ? encryptField(m.settlementAccountNumber)
          : null,
        processorSubaccountCode: m.processorSubaccountCode ?? null,
        quaiAddress: m.quaiAddress ?? null,
      },
    });
    return this.map(row);
  }
  async byId(id: string): Promise<Merchant | null> {
    const row = await this.db.merchant.findUnique({ where: { id } });
    return row ? this.map(row) : null;
  }
  async byPhone(phone: string): Promise<Merchant | null> {
    const row = await this.db.merchant.findUnique({
      where: { phoneHash: blindIndex(phone) },
    });
    return row ? this.map(row) : null;
  }
  async update(id: string, patch: Partial<Merchant>): Promise<Merchant> {
    const data: Prisma.MerchantUpdateInput = {};
    if (patch.businessName != null) data.businessName = patch.businessName;
    if (patch.status != null) data.status = patch.status;
    if (patch.kycState != null) data.kycState = patch.kycState;
    if (patch.cryptoEnabled != null) data.cryptoEnabled = patch.cryptoEnabled;
    if (patch.settlementBankCode != null) data.settlementBankCode = patch.settlementBankCode;
    if (patch.settlementAccountNumber != null) {
      data.settlementAccountEnc = encryptField(patch.settlementAccountNumber);
    }
    if (patch.processorSubaccountCode != null) {
      data.processorSubaccountCode = patch.processorSubaccountCode;
    }
    if (patch.quaiAddress != null) {
      data.quaiAddress = patch.quaiAddress;
    }
    const row = await this.db.merchant.update({ where: { id }, data }).catch(() => {
      throw new NotFoundError("merchant", { id });
    });
    return this.map(row);
  }
  async list(): Promise<Merchant[]> {
    const rows = await this.db.merchant.findMany();
    return rows.map((r) => this.map(r));
  }
  private map(r: Row): Merchant {
    return {
      id: r.id as string,
      phone: decryptField(r.phoneEnc as string),
      businessName: r.businessName as string,
      status: r.status as Merchant["status"],
      kycState: r.kycState as Merchant["kycState"],
      cryptoEnabled: r.cryptoEnabled as boolean,
      settlementBankCode: (r.settlementBankCode as string | null) ?? undefined,
      settlementAccountNumber: r.settlementAccountEnc
        ? decryptField(r.settlementAccountEnc as string)
        : undefined,
      processorSubaccountCode: (r.processorSubaccountCode as string | null) ?? undefined,
      quaiAddress: (r.quaiAddress as string | null) ?? undefined,
      createdAt: r.createdAt as Date,
    };
  }
}

class PgProductRepo implements ProductRepo {
  constructor(private db: PrismaClient) {}
  async create(p: Omit<Product, "createdAt">): Promise<Product> {
    const row = await this.db.product.create({
      data: {
        id: p.id,
        merchantId: p.merchantId,
        name: p.name,
        price: p.price,
        imageUrl: p.imageUrl ?? null,
        stockQty: p.stockQty ?? null,
      },
    });
    return this.map(row);
  }
  async byId(id: string): Promise<Product | null> {
    const row = await this.db.product.findUnique({ where: { id } });
    return row ? this.map(row) : null;
  }
  async listByMerchant(merchantId: string): Promise<Product[]> {
    const rows = await this.db.product.findMany({ where: { merchantId } });
    return rows.map((r) => this.map(r));
  }
  async update(id: string, patch: Partial<Product>): Promise<Product> {
    const row = await this.db.product.update({
      where: { id },
      data: {
        name: patch.name,
        price: patch.price,
        imageUrl: patch.imageUrl,
        stockQty: patch.stockQty,
      },
    });
    return this.map(row);
  }
  async decrementStock(id: string, qty: number): Promise<void> {
    const row = await this.db.product.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("product", { id });
    if (row.stockQty == null) return;
    await this.db.product.update({
      where: { id },
      data: { stockQty: Math.max(0, row.stockQty - qty) },
    });
  }
  private map(r: Row): Product {
    return {
      id: r.id as string,
      merchantId: r.merchantId as string,
      name: r.name as string,
      price: r.price as number,
      imageUrl: (r.imageUrl as string | null) ?? undefined,
      stockQty: (r.stockQty as number | null) ?? undefined,
      createdAt: r.createdAt as Date,
    };
  }
}

class PgOrderRepo implements OrderRepo {
  constructor(private db: PrismaClient) {}
  async create(o: Omit<Order, "createdAt">): Promise<Order> {
    const row = await this.db.order.create({
      data: {
        id: o.id,
        merchantId: o.merchantId,
        buyerRef: o.buyerRef,
        items: o.items as unknown as Prisma.InputJsonValue,
        amount: o.amount,
        rail: o.rail,
        status: o.status,
        expiresAt: o.expiresAt ?? null,
      },
    });
    return this.map(row);
  }
  async byId(id: string): Promise<Order | null> {
    const row = await this.db.order.findUnique({ where: { id } });
    return row ? this.map(row) : null;
  }
  async listByMerchant(merchantId: string): Promise<Order[]> {
    const rows = await this.db.order.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.map(r));
  }
  async updateStatus(id: string, status: OrderStatus): Promise<Order> {
    const row = await this.db.order.update({ where: { id }, data: { status } });
    return this.map(row);
  }
  private map(r: Row): Order {
    return {
      id: r.id as string,
      merchantId: r.merchantId as string,
      buyerRef: r.buyerRef as string,
      items: r.items as OrderItem[],
      amount: r.amount as number,
      rail: r.rail as Order["rail"],
      status: r.status as OrderStatus,
      createdAt: r.createdAt as Date,
      expiresAt: (r.expiresAt as Date | null) ?? undefined,
    };
  }
}

class PgPaymentRepo implements PaymentRepo {
  constructor(private db: PrismaClient) {}
  async create(p: Omit<Payment, "createdAt">): Promise<Payment> {
    const row = await this.db.payment.create({
      data: {
        id: p.id,
        orderId: p.orderId,
        railId: p.railId,
        providerRef: p.providerRef,
        instructionType: p.instructionType,
        amount: p.amount,
        status: p.status,
        confirmedAt: p.confirmedAt ?? null,
      },
    });
    return this.map(row);
  }
  async byId(id: string): Promise<Payment | null> {
    const row = await this.db.payment.findUnique({ where: { id } });
    return row ? this.map(row) : null;
  }
  async byOrderId(orderId: string): Promise<Payment | null> {
    const row = await this.db.payment.findUnique({ where: { orderId } });
    return row ? this.map(row) : null;
  }
  async byProviderRef(providerRef: string): Promise<Payment | null> {
    const row = await this.db.payment.findFirst({
      where: { providerRef },
      orderBy: { createdAt: "desc" },
    });
    return row ? this.map(row) : null;
  }
  async findPendingByProviderRef(providerRef: string): Promise<Payment | null> {
    const row = await this.db.payment.findFirst({
      where: { providerRef, status: "pending" },
      orderBy: { createdAt: "asc" },
    });
    return row ? this.map(row) : null;
  }
  async markConfirmed(id: string, confirmedAt: Date): Promise<Payment> {
    const row = await this.db.payment.update({
      where: { id },
      data: { status: "confirmed", confirmedAt },
    });
    return this.map(row);
  }
  async updateStatus(id: string, status: PaymentStatus): Promise<Payment> {
    const row = await this.db.payment.update({ where: { id }, data: { status } });
    return this.map(row);
  }
  async all(): Promise<Payment[]> {
    const rows = await this.db.payment.findMany();
    return rows.map((r) => this.map(r));
  }
  private map(r: Row): Payment {
    return {
      id: r.id as string,
      orderId: r.orderId as string,
      railId: r.railId as RailId,
      providerRef: r.providerRef as string,
      instructionType: r.instructionType as InstructionType,
      amount: r.amount as number,
      status: r.status as PaymentStatus,
      confirmedAt: (r.confirmedAt as Date | null) ?? undefined,
      createdAt: r.createdAt as Date,
    };
  }
}

class PgLedgerRepo implements LedgerRepo {
  constructor(private db: PrismaClient) {}
  /**
   * ATOMIC append inside a Serializable transaction. Reading the current
   * balance and writing the new entry happen together, so two concurrent
   * appends can never compute the same balanceAfter (Postgres will serialize
   * or abort-and-retry). This is the ledger-integrity guarantee.
   */
  async append(input: AppendLedgerInput): Promise<LedgerEntry> {
    return this.db.$transaction(
      async (tx) => {
        const agg = await tx.ledgerEntry.aggregate({
          where: { merchantId: input.merchantId },
          _sum: { amount: true },
        });
        const prev = agg._sum.amount ?? 0;
        const row = await tx.ledgerEntry.create({
          data: {
            id: id("led"),
            merchantId: input.merchantId,
            orderId: input.orderId,
            paymentId: input.paymentId,
            type: input.type,
            amount: input.amount,
            balanceAfter: prev + input.amount,
          },
        });
        return this.map(row);
      },
      { isolationLevel: "Serializable" },
    );
  }
  async listByMerchant(merchantId: string): Promise<LedgerEntry[]> {
    const rows = await this.db.ledgerEntry.findMany({
      where: { merchantId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => this.map(r));
  }
  async balance(merchantId: string): Promise<Kobo> {
    const agg = await this.db.ledgerEntry.aggregate({
      where: { merchantId },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }
  async sumByMerchant(merchantId: string): Promise<Kobo> {
    const agg = await this.db.ledgerEntry.aggregate({
      where: { merchantId, type: "sale" },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }
  private map(r: Row): LedgerEntry {
    return {
      id: r.id as string,
      merchantId: r.merchantId as string,
      orderId: r.orderId as string,
      paymentId: r.paymentId as string,
      type: r.type as LedgerEntry["type"],
      amount: r.amount as number,
      balanceAfter: r.balanceAfter as number,
      createdAt: r.createdAt as Date,
    };
  }
}

class PgBuyerRepo implements BuyerRepo {
  constructor(private db: PrismaClient) {}
  async upsert(merchantId: string, phoneOrRef: string, name?: string): Promise<Buyer> {
    const phoneHash = blindIndex(phoneOrRef);
    const existing = await this.db.buyer.findUnique({
      where: { merchantId_phoneHash: { merchantId, phoneHash } },
    });
    if (existing) return this.map(existing);
    const row = await this.db.buyer.create({
      data: {
        id: id("buy"),
        merchantId,
        phoneEnc: encryptField(phoneOrRef),
        phoneHash,
        name: name ?? null,
      },
    });
    return this.map(row);
  }
  async byId(id: string): Promise<Buyer | null> {
    const row = await this.db.buyer.findUnique({ where: { id } });
    return row ? this.map(row) : null;
  }
  async listByMerchant(merchantId: string): Promise<Buyer[]> {
    const rows = await this.db.buyer.findMany({ where: { merchantId } });
    return rows.map((r) => this.map(r));
  }
  async incrementOrderCount(id: string): Promise<void> {
    await this.db.buyer.update({
      where: { id },
      data: { orderCount: { increment: 1 } },
    });
  }
  private map(r: Row): Buyer {
    return {
      id: r.id as string,
      merchantId: r.merchantId as string,
      phoneOrRef: decryptField(r.phoneEnc as string),
      name: (r.name as string | null) ?? undefined,
      firstSeen: r.firstSeen as Date,
      orderCount: r.orderCount as number,
    };
  }
}

export function createPrismaRepositories(db: PrismaClient): Repositories {
  return {
    merchants: new PgMerchantRepo(db),
    products: new PgProductRepo(db),
    orders: new PgOrderRepo(db),
    payments: new PgPaymentRepo(db),
    ledger: new PgLedgerRepo(db),
    buyers: new PgBuyerRepo(db),
  };
}
