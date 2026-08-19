import type { NotificationTransport } from "./transport.js";
import type { Repositories } from "../../db/repositories.js";
import { formatNaira, type Kobo } from "../../lib/money.js";
import { logger } from "../../lib/logger.js";
import type { Metrics } from "../metrics/metrics.js";

const log = logger("notification");

/**
 * Notification Service (§2.1) — the thing that kills manual checking. Sends the
 * merchant an auto payment-confirmation and the buyer an auto receipt. Primary
 * channel WhatsApp; falls back through SMS/email if a channel fails.
 */
export class NotificationService {
  constructor(
    private repos: Repositories,
    private channels: NotificationTransport[],
    private metrics: Metrics,
  ) {
    if (channels.length === 0) throw new Error("need at least one channel");
  }

  async notifyMerchantPaid(input: {
    merchantId: string;
    orderId: string;
    amount: Kobo;
  }): Promise<void> {
    const merchant = await this.repos.merchants.byId(input.merchantId);
    if (!merchant) return;
    // A bare "payment received for order 804DC5" makes the vendor go and look
    // up what they just sold. Name the item and the buyer so the message is
    // the whole story.
    const { lines, buyer } = await this.describeOrder(input.orderId);
    const balance = await this.repos.ledger.balance(input.merchantId).catch(() => null);
    const msg = [
      `✅ *You've been paid ${formatNaira(input.amount)}*`,
      ...(lines.length ? ["", ...lines.map((l) => `• ${l}`)] : []),
      ...(buyer ? [`Buyer: ${buyer}`] : []),
      "",
      `Order ${short(input.orderId)} · settled to your account`,
      ...(balance != null ? [`Balance: *${formatNaira(balance)}*`] : []),
      "",
      "Type *ledger* to see your books.",
    ].join("\n");
    await this.deliver(merchant.phone, msg, "merchant_confirmation", merchant.waPhoneNumberId);
  }

  async sendReceiptToBuyer(input: {
    merchantId: string;
    orderId: string;
    buyerRef: string;
    amount: Kobo;
  }): Promise<void> {
    const merchant = await this.repos.merchants.byId(input.merchantId);
    const buyer = await this.repos.buyers.byId(input.buyerRef);
    const to = buyer?.phoneOrRef ?? input.buyerRef;
    const biz = merchant?.businessName ?? "the merchant";
    const { lines } = await this.describeOrder(input.orderId);
    const msg = [
      `🧾 *Receipt from ${biz}*`,
      ...(lines.length ? ["", ...lines.map((l) => `• ${l}`)] : []),
      "",
      `Total paid: *${formatNaira(input.amount)}*`,
      `Order ${short(input.orderId)}`,
      "",
      "Thank you for shopping with us! 💚",
    ].join("\n");
    // From the vendor's own number when they have one: the buyer's 24-hour
    // messaging window was opened there, and a receipt arriving from a number
    // they never messaged reads as spam even when Meta does let it through.
    await this.deliver(to, msg, "buyer_receipt", merchant?.waPhoneNumberId);
  }

  /**
   * Resolve an order into human line items ("2 × Red Lipstick — ₦10,000.00").
   * Best-effort: a missing product must never stop a receipt going out, so
   * every lookup degrades to an empty list rather than throwing.
   */
  private async describeOrder(
    orderId: string,
  ): Promise<{ lines: string[]; buyer: string | null }> {
    try {
      const order = await this.repos.orders.byId(orderId);
      if (!order) return { lines: [], buyer: null };
      const lines: string[] = [];
      for (const item of order.items) {
        const product = await this.repos.products.byId(item.productId).catch(() => null);
        const name = product?.name ?? "Item";
        lines.push(
          item.qty > 1
            ? `${item.qty} × ${name} — ${formatNaira(item.qty * (product?.price ?? 0))}`
            : `${name} — ${formatNaira(product?.price ?? 0)}`,
        );
      }
      // buyerRef may be a buyer id OR a raw phone depending on how the order was
      // created. Resolve ids to a phone — a vendor shown "buy_8f7e082a-…" learns
      // nothing about who just bought from them.
      let buyer: string | null = order.buyerRef || null;
      if (buyer?.startsWith("buy_")) {
        const record = await this.repos.buyers.byId(buyer).catch(() => null);
        buyer = record?.phoneOrRef ?? null;
      }
      return { lines, buyer };
    } catch {
      return { lines: [], buyer: null };
    }
  }

  /** Try channels in priority order; first success wins. */
  private async deliver(
    to: string,
    message: string,
    kind: string,
    phoneNumberId?: string,
  ): Promise<void> {
    for (const channel of this.channels) {
      try {
        const res = await channel.send(to, message, { phoneNumberId });
        if (res.ok) {
          // WhatsApp conversation cost is a first-class metric from day one.
          if (channel.channel === "whatsapp") {
            this.metrics.increment("whatsapp_conversations_total");
          }
          this.metrics.increment(`notification_sent_${kind}`);
          return;
        }
      } catch (err) {
        log.warn(
          { channel: channel.channel, err: (err as Error).message },
          "channel failed, falling back",
        );
      }
    }
    this.metrics.increment(`notification_failed_${kind}`);
    log.error({ kind, to: mask(to) }, "all notification channels failed");
  }
}

function short(id: string): string {
  return id.slice(-6).toUpperCase();
}
function mask(s: string): string {
  return s.length <= 4 ? "****" : `${s.slice(0, 3)}***${s.slice(-2)}`;
}
