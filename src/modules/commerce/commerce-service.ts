import type { Repositories } from "../../db/repositories.js";
import type { ObjectStore } from "../storage/object-store.js";
import type { Clock } from "../../lib/clock.js";
import type { Order, OrderItem, Product } from "../../domain/types.js";
import { assertTransition } from "../../domain/order-state.js";
import { assertKobo, type Kobo } from "../../lib/money.js";
import { id } from "../../lib/ids.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";

const log = logger("commerce");

export interface CreateProductInput {
  merchantId: string;
  name: string;
  price: Kobo;
  image?: { bytes: Buffer; contentType: string };
  /**
   * A ready-made image path, for products whose picture is already hosted —
   * the seeded demo catalogue points at files committed under `public/`.
   * Ignored when `image` bytes are supplied, since an actual upload is the
   * more specific intent.
   */
  imageUrl?: string;
  stockQty?: number;
}

export interface CreateOrderInput {
  merchantId: string;
  buyerRef: string;
  /**
   * Buyer's display name, when a channel collects one. The buyers table has
   * always had the column; only the WhatsApp flow, which never asks, left it
   * unset. The web storefront does ask, and a vendor packing an order is far
   * better served by "Ada Okeke" than by a bare phone number.
   */
  buyerName?: string;
  lines: { productId: string; qty: number }[];
  ttlMs?: number;
  /** Payment rail: bank transfer (default) or crypto (Quai/BlipPay). */
  rail?: "fiat" | "crypto";
}

/**
 * Commerce Service (§2.1) — catalogue CRUD and order creation. Owns the order
 * lifecycle; the payment orchestrator drives it into `paid`.
 */
export class CommerceService {
  constructor(
    private repos: Repositories,
    private objects: ObjectStore,
    private clock: Clock,
  ) {}

  async createProduct(input: CreateProductInput): Promise<Product> {
    assertKobo(input.price);
    if (!input.name.trim()) throw new ValidationError("product name required");
    const merchant = await this.repos.merchants.byId(input.merchantId);
    if (!merchant) throw new NotFoundError("merchant", { id: input.merchantId });

    let imageUrl: string | undefined = input.imageUrl;
    if (input.image) {
      const { url } = await this.objects.put(
        input.image.bytes,
        input.image.contentType,
      );
      imageUrl = url;
    }
    const product = await this.repos.products.create({
      id: id("prod"),
      merchantId: input.merchantId,
      name: input.name.trim(),
      price: input.price,
      imageUrl,
      stockQty: input.stockQty,
    });
    log.info({ productId: product.id, merchantId: input.merchantId }, "product created");
    return product;
  }

  listProducts(merchantId: string): Promise<Product[]> {
    return this.repos.products.listByMerchant(merchantId);
  }

  async createOrder(input: CreateOrderInput): Promise<Order> {
    if (input.lines.length === 0) {
      throw new ValidationError("order needs at least one line");
    }
    const items: OrderItem[] = [];
    let amount = 0;
    for (const line of input.lines) {
      if (line.qty <= 0) throw new ValidationError("qty must be positive");
      const product = await this.repos.products.byId(line.productId);
      if (!product) throw new NotFoundError("product", { id: line.productId });
      if (product.merchantId !== input.merchantId) {
        throw new ValidationError("product does not belong to merchant");
      }
      if (product.stockQty != null && product.stockQty < line.qty) {
        throw new ValidationError(`insufficient stock for ${product.name}`);
      }
      items.push({
        productId: product.id,
        name: product.name,
        unitPrice: product.price,
        qty: line.qty,
      });
      amount += product.price * line.qty;
    }
    assertKobo(amount);

    const buyer = await this.repos.buyers.upsert(
      input.merchantId,
      input.buyerRef,
      input.buyerName,
    );
    const order = await this.repos.orders.create({
      id: id("ord"),
      merchantId: input.merchantId,
      buyerRef: buyer.id,
      items,
      amount,
      rail: input.rail ?? "fiat",
      status: "draft",
      expiresAt: input.ttlMs
        ? new Date(this.clock.now().getTime() + input.ttlMs)
        : undefined,
    });
    log.info({ orderId: order.id, amount }, "order created");
    return order;
  }

  /**
   * Put a photograph on a product that already exists.
   *
   * Separate from createProduct because the picture usually arrives after the
   * product does — a vendor names the thing, then takes the photo.
   */
  async setProductImage(
    productId: string,
    image: { bytes: Buffer; contentType: string },
  ): Promise<Product> {
    const product = await this.repos.products.byId(productId);
    if (!product) throw new NotFoundError("product", { id: productId });
    const { url } = await this.objects.put(image.bytes, image.contentType);
    const updated = await this.repos.products.update(productId, { imageUrl: url });
    log.info({ productId }, "product image set");
    return updated;
  }

  /** draft → awaiting_payment, once a payment instruction is issued. */
  async markAwaitingPayment(orderId: string): Promise<Order> {
    return this.transition(orderId, "awaiting_payment");
  }

  async markFulfilled(orderId: string): Promise<Order> {
    return this.transition(orderId, "fulfilled");
  }

  async cancel(orderId: string): Promise<Order> {
    return this.transition(orderId, "cancelled");
  }

  private async transition(orderId: string, to: Order["status"]): Promise<Order> {
    const order = await this.repos.orders.byId(orderId);
    if (!order) throw new NotFoundError("order", { id: orderId });
    assertTransition(order.status, to);
    return this.repos.orders.updateStatus(orderId, to);
  }
}
