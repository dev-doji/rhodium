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
    const msg =
      `✅ Payment received: ${formatNaira(input.amount)} for order ` +
      `${short(input.orderId)}. It's in your ledger.`;
    await this.deliver(merchant.phone, msg, "merchant_confirmation");
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
    const msg =
      `🧾 Receipt from ${biz}\nOrder ${short(input.orderId)}\n` +
      `Amount paid: ${formatNaira(input.amount)}\nThank you!`;
    await this.deliver(to, msg, "buyer_receipt");
  }

  /** Try channels in priority order; first success wins. */
  private async deliver(to: string, message: string, kind: string): Promise<void> {
    for (const channel of this.channels) {
      try {
        const res = await channel.send(to, message);
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
