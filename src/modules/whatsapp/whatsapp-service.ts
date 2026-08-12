import type { NotificationTransport } from "../notification/transport.js";
import type { CommerceService } from "../commerce/commerce-service.js";
import type { PaymentsOrchestrator } from "../payments/payments-orchestrator.js";
import type { LedgerService } from "../ledger/ledger-service.js";
import type { Repositories } from "../../db/repositories.js";
import type { ConversationStore } from "./conversation-store.js";
import { bankMenu, pickBank } from "./banks.js";
import { formatNaira, nairaToKobo } from "../../lib/money.js";
import { ref } from "../../lib/ids.js";
import { logger } from "../../lib/logger.js";
import { AppError } from "../../lib/errors.js";

const log = logger("whatsapp-service");

export interface InboundMessage {
  from: string; // sender WA id (phone, E.164)
  text: string;
}

export interface WhatsAppOptions {
  publicBaseUrl: string;
  waNumber: string; // digits for wa.me links (e.g. 15551405536)
}

/** Format a crypto base-unit amount for humans (QUAI=18 dp, USDT=6 dp). */
function humanCrypto(cryptoAmount?: string, symbol?: string): string {
  if (!cryptoAmount) return "?";
  const decimals = symbol === "QUAI" ? 18 : 6;
  const n = Number(cryptoAmount) / Math.pow(10, decimals);
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${symbol ?? ""}`.trim();
}

/**
 * WhatsApp Service — a conversational storefront in chat.
 *
 *  • Unknown sender says anything → guided *vendor onboarding* (business name →
 *    bank account → bank), which creates an active merchant.
 *  • Registered merchant → vendor commands (list / add / sell / ledger / link).
 *  • Buyer opens a vendor's deep link (`shop-<merchantId>`) → sees the catalogue,
 *    picks a product, chooses bank or crypto, and gets a pay instruction/link.
 *
 * All multi-step flows use a per-user conversation store.
 */
export class WhatsAppService {
  constructor(
    private transport: NotificationTransport,
    private commerce: CommerceService,
    private payments: PaymentsOrchestrator,
    private ledger: LedgerService,
    private repos: Repositories,
    private convo: ConversationStore,
    private opts: WhatsAppOptions,
  ) {}

  async handleInbound(msg: InboundMessage): Promise<string> {
    const from = msg.from;
    const text = (msg.text ?? "").trim();
    let reply: string;
    try {
      reply = await this.route(from, text);
    } catch (err) {
      const message = err instanceof AppError ? err.message : "something went wrong";
      log.warn({ err: (err as Error).message }, "inbound failed");
      reply = `⚠️ ${message}`;
    }
    await this.reply(from, reply);
    return reply;
  }

  private async route(from: string, text: string): Promise<string> {
    // 1) Mid-conversation (onboarding or buying) → continue it.
    const state = this.convo.get(from);
    if (state) return this.continueConversation(from, text, state.step, state.data);

    // 2) Registered merchant → vendor commands.
    const merchant = await this.repos.merchants.byPhone(from);
    if (merchant) return this.vendorCommand(merchant.id, merchant.phone, text);

    // 3) Buyer deep link: "shop-<merchantId>".
    const shop = text.match(/^shop[-\s]+(\S+)/i);
    if (shop) return this.startBuyerFlow(from, shop[1]!);

    // 4) New unknown sender → greet + start onboarding.
    return this.startOnboarding(from);
  }

  // ---------------------------------------------------------------------------
  // Vendor onboarding (guided)
  // ---------------------------------------------------------------------------
  private startOnboarding(from: string): string {
    this.convo.set(from, "onboard:business_name", {});
    return [
      "Hello 👋 We're *Rhodium*.",
      "We help you sell and collect payments right here in WhatsApp — by bank transfer or crypto — and keep your sales records automatically.",
      "",
      "Let's set up your business (takes 30 seconds).",
      "",
      "What's your *business name*?",
    ].join("\n");
  }

  private async continueConversation(
    from: string,
    text: string,
    step: string,
    data: Record<string, unknown>,
  ): Promise<string> {
    switch (step) {
      case "onboard:business_name": {
        if (text.length < 2) return "Please tell me your business name.";
        data.businessName = text;
        this.convo.set(from, "onboard:account_number", data);
        return `Nice to meet you, *${text}*! 🎉\n\nWhich bank account should we settle your money into?\nSend your *10-digit account number*.`;
      }
      case "onboard:account_number": {
        const acct = text.replace(/\s/g, "");
        if (!/^\d{10}$/.test(acct)) {
          return "That doesn't look right — send your *10-digit* account number (numbers only).";
        }
        data.accountNumber = acct;
        this.convo.set(from, "onboard:bank", data);
        return `Which bank is that?\n\n${bankMenu()}\n\nReply with the *number*.`;
      }
      case "onboard:bank": {
        const bank = pickBank(text);
        if (!bank) return "Please reply with the number of your bank from the list.";
        const merchant = await this.repos.merchants.create({
          id: ref("mch"),
          phone: from,
          businessName: String(data.businessName),
          status: "active",
          kycState: "verified",
          cryptoEnabled: true,
          settlementBankCode: bank.code,
          settlementAccountNumber: String(data.accountNumber),
        });
        this.convo.clear(from);
        return [
          `✅ *${merchant.businessName}* is all set up!`,
          `Payouts: ${bank.name} ••••${String(data.accountNumber).slice(-4)}`,
          "",
          "Add your first product:",
          "*add Lipstick 5000*",
          "",
          "Then type *link* to get your shareable shop link, or *help* for all commands.",
        ].join("\n");
      }
      // ----- buyer flow -----
      case "buy:select_product": {
        const ids = (data.productIds as string[]) ?? [];
        const idx = parseInt(text, 10) - 1;
        if (Number.isNaN(idx) || idx < 0 || idx >= ids.length) {
          return "Please reply with a valid product number from the list.";
        }
        const product = await this.repos.products.byId(ids[idx]!);
        data.productId = ids[idx];
        this.convo.set(from, "buy:select_method", data);
        return `You picked *${product?.name}* (${formatNaira(product?.price ?? 0)}).\n\nHow would you like to pay?\n1) Bank transfer\n2) Crypto (BlipPay)`;
      }
      case "buy:select_method": {
        const rail = /^2|crypto|blip/i.test(text.trim()) ? "crypto" : "fiat";
        const order = await this.commerce.createOrder({
          merchantId: String(data.merchantId),
          buyerRef: from,
          lines: [{ productId: String(data.productId), qty: 1 }],
          ttlMs: 60 * 60 * 1000,
          rail,
        });
        const instruction = await this.payments.requestPayment(order.id);
        this.convo.clear(from);
        const orderRef = order.id.slice(-6).toUpperCase();
        if (rail === "crypto") {
          return [
            `Pay for order ${orderRef}`,
            `Amount: ${formatNaira(order.amount)} (≈ ${humanCrypto(instruction.cryptoAmount, instruction.tokenSymbol)})`,
            "",
            "Tap to pay (opens BlipPay):",
            `${instruction.checkoutUrl}`,
            "",
            "You'll get a receipt here once it confirms on-chain.",
          ].join("\n");
        }
        return [
          `Pay for order ${orderRef}`,
          `Amount: ${formatNaira(order.amount)}`,
          "",
          "Transfer to:",
          `🏦 ${instruction.bankName}`,
          `#️⃣ ${instruction.accountNumber}`,
          `👤 ${instruction.accountName}`,
          "",
          "You'll get a receipt here the moment it lands.",
        ].join("\n");
      }
      default:
        this.convo.clear(from);
        return this.startOnboarding(from);
    }
  }

  // ---------------------------------------------------------------------------
  // Buyer storefront
  // ---------------------------------------------------------------------------
  private async startBuyerFlow(from: string, merchantId: string): Promise<string> {
    const merchant = await this.repos.merchants.byId(merchantId);
    if (!merchant) return "Sorry, that shop isn't available — please check the link.";
    const products = await this.commerce.listProducts(merchantId);
    if (products.length === 0) {
      return `*${merchant.businessName}* hasn't added products yet. Check back soon!`;
    }
    this.convo.set(from, "buy:select_product", {
      merchantId,
      productIds: products.map((p) => p.id),
    });
    const list = products
      .map((p, i) => `${i + 1}) ${p.name} — ${formatNaira(p.price)}`)
      .join("\n");
    return [
      `🛍️ *${merchant.businessName}*`,
      "",
      list,
      "",
      "Reply with the *number* of the product you want to buy.",
    ].join("\n");
  }

  // ---------------------------------------------------------------------------
  // Vendor commands
  // ---------------------------------------------------------------------------
  private async vendorCommand(merchantId: string, merchantPhone: string, text: string): Promise<string> {
    const [command, ...rest] = text.split(/\s+/);
    switch ((command ?? "").toLowerCase()) {
      case "help":
      case "hi":
      case "hello":
      case "menu":
        return this.menu();
      case "list":
        return this.listProducts(merchantId);
      case "add":
        return this.addProduct(merchantId, rest);
      case "sell":
        return this.sell(merchantId, rest);
      case "link":
      case "myshop":
      case "shop":
        return this.shopLink(merchantId);
      case "ledger":
      case "sales":
      case "balance":
      case "books":
        return this.salesLedger(merchantId, merchantPhone);
      default:
        return `Didn't get that. ${this.menu()}`;
    }
  }

  private menu(): string {
    return [
      "🛍️ *Rhodium commands:*",
      "• *list* — see your products",
      "• *add <name> <price>* — e.g. add Lipstick 5000",
      "• *link* — your shareable shop link for buyers",
      "• *sell <productId> <qty> <buyerPhone>* — bank-transfer payment",
      "• *sell <productId> <qty> <buyerPhone> crypto* — BlipPay/Quai payment",
      "• *ledger* — your sales + running balance",
    ].join("\n");
  }

  private shopLink(merchantId: string): string {
    if (this.opts.waNumber) {
      return [
        "Your shop link — share it with buyers:",
        `https://wa.me/${this.opts.waNumber}?text=shop-${merchantId}`,
        "",
        "When a buyer opens it, they'll see your products and can pay in a couple of taps.",
      ].join("\n");
    }
    return `Your shop id: *shop-${merchantId}*\nBuyers message this number with that to see your catalogue.`;
  }

  private async listProducts(merchantId: string): Promise<string> {
    const products = await this.commerce.listProducts(merchantId);
    if (products.length === 0) return "No products yet. Add one: *add Lipstick 5000*";
    return products
      .map((p) => `• ${p.name} — ${formatNaira(p.price)} (${p.id})`)
      .join("\n");
  }

  private async addProduct(merchantId: string, args: string[]): Promise<string> {
    const priceStr = args.at(-1);
    const name = args.slice(0, -1).join(" ");
    const price = Number(priceStr);
    if (!name || !priceStr || Number.isNaN(price)) {
      return "Usage: *add <name> <price>*  e.g. add Red Lipstick 5000";
    }
    const product = await this.commerce.createProduct({
      merchantId,
      name,
      price: nairaToKobo(price),
    });
    return `✅ Added *${product.name}* at ${formatNaira(product.price)}\nID: ${product.id}\n\nType *link* to share your shop with buyers.`;
  }

  private async sell(merchantId: string, args: string[]): Promise<string> {
    const [productId, qtyStr, buyerPhone, mode] = args;
    const qty = Number(qtyStr);
    if (!productId || !buyerPhone || Number.isNaN(qty) || qty <= 0) {
      return "Usage: *sell <productId> <qty> <buyerPhone> [crypto]*";
    }
    const isCrypto = (mode ?? "").toLowerCase() === "crypto";
    const order = await this.commerce.createOrder({
      merchantId,
      buyerRef: buyerPhone,
      lines: [{ productId, qty }],
      ttlMs: 60 * 60 * 1000,
      rail: isCrypto ? "crypto" : "fiat",
    });
    const instruction = await this.payments.requestPayment(order.id);
    const orderRef = order.id.slice(-6).toUpperCase();

    if (isCrypto) {
      return [
        `Crypto payment request — order ${orderRef}`,
        `Amount: ${formatNaira(order.amount)} (≈ ${humanCrypto(instruction.cryptoAmount, instruction.tokenSymbol)})`,
        "",
        "Send your buyer this link — it opens in BlipPay to pay:",
        `${instruction.checkoutUrl}`,
        "",
        "It settles to YOUR wallet directly. You'll be auto-notified when it confirms on-chain.",
      ].join("\n");
    }
    return [
      `🧾 Payment request — order ${orderRef}`,
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
      "📒 *Your sales ledger*",
      `Balance: ${formatNaira(balance)} across ${entries.length} sale${entries.length === 1 ? "" : "s"}`,
      "",
      "Recent:",
      ...recent,
      "",
      `Full books + CSV export: ${this.opts.publicBaseUrl} (sign in with this number)`,
    ].join("\n");
  }

  private async reply(to: string, message: string): Promise<void> {
    await this.transport.send(to, message);
  }
}
