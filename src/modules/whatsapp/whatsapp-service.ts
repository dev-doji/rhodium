import type { NotificationTransport } from "../notification/transport.js";
import type { CommerceService } from "../commerce/commerce-service.js";
import type { PaymentsOrchestrator } from "../payments/payments-orchestrator.js";
import type { LedgerService } from "../ledger/ledger-service.js";
import type { WalletService } from "../wallet/wallet-service.js";
import type { Repositories } from "../../db/repositories.js";
import type { ConversationStore } from "./conversation-store.js";
import { bankMenu, pickBank } from "./banks.js";
import { formatNaira, nairaToKobo } from "../../lib/money.js";
import { ref } from "../../lib/ids.js";
import { logger } from "../../lib/logger.js";
import { AppError } from "../../lib/errors.js";

const log = logger("whatsapp-service");

/** Every word `vendorCommand` dispatches on — kept in sync with that switch. */
const COMMAND_WORDS = new Set([
  "help",
  "hi",
  "hello",
  "menu",
  "list",
  "add",
  "sell",
  "link",
  "myshop",
  "shop",
  "ledger",
  "sales",
  "balance",
  "books",
]);

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
    private wallets: WalletService,
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
  /**
   * First contact (e.g. someone opening the wa.me link from the landing page).
   * Greeting → what they get → the ask. The service list is shown up front so a
   * brand-new vendor can see what they're signing up for before answering, but
   * the sign-up question stays last so it's the thing they reply to.
   */
  private startOnboarding(from: string): string {
    this.convo.set(from, "onboard:business_name", {});
    return [
      "Hello 👋 We're *Rhodium*.",
      "We help you sell and collect payments right here in WhatsApp — by bank transfer or crypto — and keep your sales records automatically.",
      "",
      "*Here's what you'll be able to do:*",
      "• *list* / *add* — build your product catalogue",
      "• *link* — share a shop link buyers can order from",
      "• *sell* — charge a buyer by bank transfer or crypto",
      "• *ledger* — every sale, with a running balance",
      "",
      "Let's set up your business (takes 30 seconds).",
      "",
      "👉 What's your *business name*?",
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
        // The greeting lists the commands, so people reflexively type one back.
        // Without this, "menu" would silently become their business name.
        if (COMMAND_WORDS.has(text.toLowerCase())) {
          return [
            `*${text}* is one of my commands — you'll be able to use it once you're set up.`,
            "",
            "👉 First, what's your *business name*?",
          ].join("\n");
        }
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
        // Generate an embedded Quai wallet so they can accept crypto instantly.
        // Resilient: if generation fails, onboarding still succeeds (bank only).
        let walletLine = "";
        try {
          const wallet = await this.wallets.generateCyprus1();
          await this.repos.merchants.setWalletSecrets(merchant.id, wallet.mnemonic, wallet.privateKey);
          await this.repos.merchants.update(merchant.id, { quaiAddress: wallet.address });
          walletLine = `\n🪙 We created your crypto wallet: ${wallet.address.slice(0, 10)}…${wallet.address.slice(-4)}\n⚠️ Back it up now: ${this.opts.publicBaseUrl}/wallet (verify with the code we text you). It's the only way to control your crypto funds.`;
        } catch (err) {
          log.warn({ err: (err as Error).message }, "wallet generation failed during onboarding");
        }
        this.convo.clear(from);
        return [
          `✅ *${merchant.businessName}* is all set up!`,
          `Payouts (bank): ${bank.name} ••••${String(data.accountNumber).slice(-4)}${walletLine}`,
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
        return [
          `You picked *${product?.name}* (${formatNaira(product?.price ?? 0)}).`,
          "",
          "How would you like to pay?",
          "1) Bank transfer",
          "2) Pay with stablecoin (USDT) — seller receives naira",
          "3) Pay with QUAI (BlipPay wallet)",
        ].join("\n");
      }
      case "buy:select_method": {
        const c = text.trim();
        const orderRef = () => order.id.slice(-6).toUpperCase();
        // 2 = OnSwitch off-ramp (crypto → naira), 3 = Quai wallet, else bank.
        const isOfframp = /^2|usdt|usdc|stable|naira/i.test(c);
        const isQuai = /^3|quai|blip/i.test(c);
        const rail = isOfframp || isQuai ? "crypto" : "fiat";
        const order = await this.commerce.createOrder({
          merchantId: String(data.merchantId),
          buyerRef: from,
          lines: [{ productId: String(data.productId), qty: 1 }],
          ttlMs: 60 * 60 * 1000,
          rail,
        });
        this.convo.clear(from);

        // Name the item on every instruction — by this point the buyer has sent
        // two bare numbers, and an order code alone gives them nothing to check
        // the amount against.
        const bought = await this.repos.products.byId(String(data.productId)).catch(() => null);
        const itemName = bought?.name ?? "your order";

        if (isOfframp) {
          const inst = await this.payments.requestPayment(order.id, "onswitch");
          return [
            `🧾 *${itemName}* — ${formatNaira(order.amount)}`,
            `Order ${orderRef()}`,
            "",
            `*Send ${inst.cryptoAmount} ${inst.tokenSymbol}* on *${inst.network}* to:`,
            `${inst.depositAddress}`,
            "",
            `The seller receives ${formatNaira(order.amount)} in their bank automatically.`,
            "You'll get a receipt here once it settles.",
          ].join("\n");
        }
        if (isQuai) {
          const inst = await this.payments.requestPayment(order.id);
          return [
            `🧾 *${itemName}* — ${formatNaira(order.amount)}`,
            `Order ${orderRef()} · ≈ ${humanCrypto(inst.cryptoAmount, inst.tokenSymbol)}`,
            "",
            "👉 *Tap to pay:*",
            `${inst.checkoutUrl}`,
            "",
            "Opens BlipPay / Pelagus. You'll get a receipt here once it",
            "confirms on-chain.",
          ].join("\n");
        }
        const inst = await this.payments.requestPayment(order.id);
        return [
          `🧾 *${itemName}* — ${formatNaira(order.amount)}`,
          `Order ${orderRef()}`,
          "",
          "*Transfer to this account:*",
          `🏦 ${inst.bankName}`,
          `#️⃣ *${inst.accountNumber}*`,
          `👤 ${inst.accountName}`,
          "",
          "This account is for THIS order only — we detect your transfer",
          "automatically. No screenshot needed.",
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

  /**
   * WhatsApp only understands *bold*, _italic_, ~strike~ and ```mono``` — single
   * backticks render literally, so commands are bolded rather than code-quoted.
   * Grouped under headings because a flat six-line list reads as a wall of text
   * on a phone.
   */
  private menu(): string {
    return [
      "🛍️ *Rhodium* — here's what I can do 👇",
      "",
      "*📦 Your products*",
      "• *list* — everything you're selling",
      "• *add <name> <price>* — _add Lipstick 5000_",
      "",
      "*🔗 Get buyers*",
      "• *link* — your shareable shop link",
      "",
      "*💳 Take a payment*",
      "• *sell <productId> <qty> <buyerPhone>*",
      "   ↳ add *crypto* on the end for BlipPay/Quai",
      "",
      "*📒 Your money*",
      "• *ledger* — sales + running balance",
      "",
      "_Send *menu* anytime to see this again._",
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
