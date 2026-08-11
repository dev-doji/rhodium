import type { NotificationTransport } from "../notification/transport.js";
import type { CommerceService } from "../commerce/commerce-service.js";
import type { PaymentsOrchestrator } from "../payments/payments-orchestrator.js";
import type { Repositories } from "../../db/repositories.js";
import { formatNaira, nairaToKobo } from "../../lib/money.js";
import { logger } from "../../lib/logger.js";
import { AppError } from "../../lib/errors.js";

const log = logger("whatsapp-service");

export interface InboundMessage {
  from: string; // sender WA id (phone)
  text: string;
}

/**
 * WhatsApp Service (§2.1) — the merchant's command surface inside their existing
 * chat. Parses inbound text into commerce actions and replies. Kept deliberately
 * thin (WhatsApp Flows catalogue browsing is out of MVP scope, §1.5).
 *
 * Commands:
 *   help                      → menu
 *   list                      → catalogue
 *   add <name> <priceNaira>   → create product
 *   sell <productId> <qty> <buyerPhone> [crypto] → create order + payment request
 *        (bank-transfer DVA by default, or a BlipPay/Quai crypto link if "crypto")
 */
export class WhatsAppService {
  constructor(
    private transport: NotificationTransport,
    private commerce: CommerceService,
    private payments: PaymentsOrchestrator,
    private repos: Repositories,
  ) {}

  async handleInbound(msg: InboundMessage): Promise<string> {
    const merchant = await this.repos.merchants.byPhone(msg.from);
    if (!merchant) {
      const reply =
        "👋 Welcome to Rhodium. This number isn't registered yet — sign in on the dashboard with this phone to get started.";
      await this.reply(msg.from, reply);
      return reply;
    }

    const [command, ...rest] = msg.text.trim().split(/\s+/);
    let reply: string;
    try {
      switch ((command ?? "").toLowerCase()) {
        case "help":
        case "hi":
        case "menu":
          reply = this.menu();
          break;
        case "list":
          reply = await this.listProducts(merchant.id);
          break;
        case "add":
          reply = await this.addProduct(merchant.id, rest);
          break;
        case "sell":
          reply = await this.sell(merchant.id, rest);
          break;
        default:
          reply = `Didn't get that. ${this.menu()}`;
      }
    } catch (err) {
      const message = err instanceof AppError ? err.message : "something went wrong";
      log.warn({ err: (err as Error).message }, "command failed");
      reply = `⚠️ ${message}`;
    }
    await this.reply(msg.from, reply);
    return reply;
  }

  private menu(): string {
    return [
      "🛍️ Rhodium commands:",
      "• list — see your products",
      "• add <name> <price> — e.g. add Lipstick 5000",
      "• sell <productId> <qty> <buyerPhone> — request bank-transfer payment",
      "• sell <productId> <qty> <buyerPhone> crypto — request BlipPay/Quai payment",
    ].join("\n");
  }

  private async listProducts(merchantId: string): Promise<string> {
    const products = await this.commerce.listProducts(merchantId);
    if (products.length === 0) return "No products yet. Add one: add Lipstick 5000";
    return products
      .map((p) => `• ${p.name} — ${formatNaira(p.price)} (${p.id})`)
      .join("\n");
  }

  private async addProduct(merchantId: string, args: string[]): Promise<string> {
    const priceStr = args.at(-1);
    const name = args.slice(0, -1).join(" ");
    const price = Number(priceStr);
    if (!name || !priceStr || Number.isNaN(price)) {
      return "Usage: add <name> <price>  e.g. add Red Lipstick 5000";
    }
    const product = await this.commerce.createProduct({
      merchantId,
      name,
      price: nairaToKobo(price),
    });
    return `✅ Added ${product.name} at ${formatNaira(product.price)}\nID: ${product.id}`;
  }

  private async sell(merchantId: string, args: string[]): Promise<string> {
    const [productId, qtyStr, buyerPhone, mode] = args;
    const qty = Number(qtyStr);
    if (!productId || !buyerPhone || Number.isNaN(qty) || qty <= 0) {
      return "Usage: sell <productId> <qty> <buyerPhone> [crypto]";
    }
    const isCrypto = (mode ?? "").toLowerCase() === "crypto";
    const order = await this.commerce.createOrder({
      merchantId,
      buyerRef: buyerPhone,
      lines: [{ productId, qty }],
      ttlMs: 60 * 60 * 1000, // 1h to pay
      rail: isCrypto ? "crypto" : "fiat",
    });
    const instruction = await this.payments.requestPayment(order.id);
    const ref = order.id.slice(-6).toUpperCase();

    if (isCrypto) {
      // Send this link to the buyer in WhatsApp — it opens in BlipPay.
      return [
        `🪙 Crypto payment request for order ${ref}`,
        `Amount: ${formatNaira(order.amount)} (~${instruction.cryptoAmount &&
          (Number(instruction.cryptoAmount) / 1e6).toFixed(2)} ${instruction.tokenSymbol})`,
        "",
        "Send your buyer this link — it opens in BlipPay to pay:",
        `${instruction.checkoutUrl}`,
        "",
        "They pay from their BlipPay wallet; it settles to YOUR wallet directly.",
        "You'll be auto-notified the moment it confirms on-chain.",
      ].join("\n");
    }

    // Present the DVA to the buyer in-chat (the "send me your account no." killer).
    return [
      `🧾 Payment request for order ${ref}`,
      `Amount: ${formatNaira(order.amount)}`,
      "",
      "Ask your buyer to transfer to:",
      `🏦 ${instruction.bankName}`,
      `#️⃣ ${instruction.accountNumber}`,
      `👤 ${instruction.accountName}`,
      "",
      "You'll be auto-notified the moment it lands — no screenshot needed.",
    ].join("\n");
  }

  private async reply(to: string, message: string): Promise<void> {
    await this.transport.send(to, message);
  }
}
