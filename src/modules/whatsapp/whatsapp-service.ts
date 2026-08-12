import type { NotificationTransport } from "../notification/transport.js";
import type { CommerceService } from "../commerce/commerce-service.js";
import type { PaymentsOrchestrator } from "../payments/payments-orchestrator.js";
import type { LedgerService } from "../ledger/ledger-service.js";
import type { Repositories } from "../../db/repositories.js";
import { formatNaira, nairaToKobo } from "../../lib/money.js";
import { logger } from "../../lib/logger.js";
import { AppError } from "../../lib/errors.js";

/** Format a crypto base-unit amount for humans (QUAI=18 dp, USDT=6 dp). */
function humanCrypto(cryptoAmount?: string, symbol?: string): string {
  if (!cryptoAmount) return "?";
  const decimals = symbol === "QUAI" ? 18 : 6;
  const n = Number(cryptoAmount) / Math.pow(10, decimals);
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${symbol ?? ""}`.trim();
}

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
    private ledger: LedgerService,
    private repos: Repositories,
    private publicBaseUrl: string,
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
        case "ledger":
        case "sales":
        case "balance":
        case "books":
          reply = await this.salesLedger(merchant.id, merchant.phone);
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
      "• ledger — your sales + running balance",
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
        `Crypto payment request — order ${ref}`,
        `Amount: ${formatNaira(order.amount)} (≈ ${humanCrypto(instruction.cryptoAmount, instruction.tokenSymbol)})`,
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

  /** Amaka's books, right in WhatsApp — the "records tool" value. */
  private async salesLedger(merchantId: string, _merchantPhone: string): Promise<string> {
    const balance = await this.ledger.balance(merchantId);
    const entries = await this.ledger.entries(merchantId);
    if (entries.length === 0) {
      return "No sales yet. Once a buyer pays, every sale lands here automatically.";
    }
    const recent = entries
      .slice(-5)
      .reverse()
      .map((e) => {
        const when = e.createdAt.toISOString().slice(5, 16).replace("T", " ");
        return `• ${formatNaira(e.amount)}  ·  ${when} UTC`;
      });
    return [
      "Your sales ledger",
      `Balance: ${formatNaira(balance)} across ${entries.length} sale${entries.length === 1 ? "" : "s"}`,
      "",
      "Recent:",
      ...recent,
      "",
      `Full books + CSV export: ${this.publicBaseUrl} (sign in with this number)`,
    ].join("\n");
  }

  private async reply(to: string, message: string): Promise<void> {
    await this.transport.send(to, message);
  }
}
