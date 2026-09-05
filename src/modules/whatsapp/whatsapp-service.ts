import type { NotificationTransport } from "../notification/transport.js";
import type { EmbeddedSignupService } from "./embedded-signup.js";
import type { HumanTakeoverStore } from "./human-takeover.js";
import type { MediaFetcher } from "./media.js";
import type { Merchant } from "../../domain/types.js";
import type { CommerceService } from "../commerce/commerce-service.js";
import type { PaymentsOrchestrator } from "../payments/payments-orchestrator.js";
import type { LedgerService } from "../ledger/ledger-service.js";
import type { WalletService } from "../wallet/wallet-service.js";
import type { Repositories } from "../../db/repositories.js";
import type { ConversationStore } from "./conversation-store.js";
import { bankMenu, pickBank, bankCodeFor } from "./banks.js";
import { formatNaira, nairaToKobo } from "../../lib/money.js";
import { koboToUsdcDisplay } from "../../lib/fx.js";
import { ref, slugify } from "../../lib/ids.js";
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
  "greeting",
  "myshop",
  "shop",
  "ledger",
  "sales",
  "balance",
  "books",
  "connect",
]);

export interface InboundMessage {
  from: string; // sender WA id (phone, E.164)
  text: string;
  /**
   * Cloud API `phone_number_id` the message ARRIVED on
   * (`value.metadata.phone_number_id`). This is the tenant key: when it belongs
   * to a vendor, the sender is talking to that vendor's shop, not to Rhodium.
   * Absent (older callers, demos) => the platform number.
   */
  toPhoneNumberId?: string;
  /** A photo she sent. `caption` is whatever she typed with it. */
  image?: { mediaId: string; caption?: string };
}

export interface WhatsAppOptions {
  /** Buyer-facing origin — checkout links a customer opens. */
  publicBaseUrl: string;
  /** Merchant-facing origin — dashboard and wallet backup. Defaults to publicBaseUrl. */
  merchantBaseUrl?: string;
  waNumber: string; // digits for wa.me links (e.g. 15551405536)
  /** Chain family the crypto rail settles on — decides the wallet we mint. */
  cryptoChain?: "quai" | "evm";
  /** Display name for that chain, e.g. "Arbitrum". Copy only. */
  cryptoChainName?: string;
  /** Rhodium's own phone_number_id — messages here are vendor onboarding. */
  platformPhoneNumberId?: string;
}

/**
 * Resolved context for one inbound message: who sent it, which number they sent
 * it to, and which vendor (if any) owns that number.
 */
interface Ctx {
  from: string;
  phoneNumberId?: string;
  tenant: Merchant | null;
  /** A photo on this message, carried through so the router can act on it. */
  image?: { mediaId: string; caption?: string };
  /** Conversation-store key, namespaced per number (see `convKey`). */
  key: string;
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
 * Multi-tenant: which number a message arrived on decides what it means.
 *
 * On a VENDOR's own number (`toPhoneNumberId` maps to a merchant):
 *  • The vendor themself → vendor commands.
 *  • Anyone else, saying anything at all → that vendor's catalogue → pay.
 *    Nobody is ever onboarded here; a buyer must never be asked for a bank
 *    account by the shop they're trying to buy from.
 *
 * On RHODIUM's own number (or no tenant id at all):
 *  • Unknown sender says anything → guided *vendor onboarding* (business name →
 *    bank account → bank), which creates an active merchant.
 *  • Registered merchant → vendor commands (list / add / sell / ledger / link).
 *  • Buyer opens a vendor's deep link (`shop-<merchantId>`) → sees the catalogue.
 *
 * All multi-step flows use a per-user conversation store, keyed per number so
 * one person can hold separate threads with two different shops.
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
    private signup?: EmbeddedSignupService,
    private takeover?: HumanTakeoverStore,
    private media?: MediaFetcher,
  ) {}

  /**
   * Which product each vendor's next photo belongs to. In memory and per
   * process: losing it costs one fallback lookup, not a product.
   */
  private awaitingPhoto = new Map<string, { productId: string; name: string }>();

  /**
   * The vendor answered a buyer by hand from the WhatsApp Business app
   * (`smb_message_echoes`). Mute the bot on that thread — see HumanTakeoverStore.
   */
  noteVendorReply(phoneNumberId: string, customerPhone: string): void {
    this.takeover?.note(convKey(customerPhone, phoneNumberId));
  }

  async handleInbound(msg: InboundMessage): Promise<string> {
    const text = (msg.text ?? "").trim();
    let ctx: Ctx = {
      from: msg.from,
      phoneNumberId: msg.toPhoneNumberId,
      tenant: null,
      image: msg.image,
      key: convKey(msg.from, msg.toPhoneNumberId),
    };
    // A human is mid-conversation here: say nothing at all. Note this runs
    // BEFORE routing, so no conversation state advances either — when the
    // window lapses the buyer picks up exactly where they left off.
    if (this.takeover?.active(ctx.key)) {
      log.info({ key: ctx.key }, "suppressed — vendor is handling this thread");
      return "";
    }
    let reply: string;
    try {
      ctx = { ...ctx, tenant: await this.resolveTenant(msg.toPhoneNumberId) };
      reply = await this.route(ctx, text);
    } catch (err) {
      const message = err instanceof AppError ? err.message : "something went wrong";
      log.warn({ err: (err as Error).message }, "inbound failed");
      reply = `⚠️ ${message}`;
    }
    await this.reply(ctx, reply);
    return reply;
  }

  /** Resolve a buyer link target: either a `mch_…` id or a human handle. */
  private async resolveShop(token: string): Promise<Merchant | null> {
    if (/^mch_/i.test(token)) return this.repos.merchants.byId(token);
    return this.repos.merchants.bySlug(token);
  }

  /**
   * A free handle derived from the business name, with a numeric suffix if it
   * is taken. Best-effort: a merchant with no handle still works via its id, so
   * a collision storm must never block someone onboarding.
   */
  /**
   * Public wrapper: merchants can be created outside the chat flow (the admin
   * test shop, future imports) and they need the same collision-free handle
   * the WhatsApp onboarding mints, not a second implementation of it.
   */
  async freeShopSlug(businessName: string): Promise<string | undefined> {
    return this.freeSlug(businessName);
  }

  private async freeSlug(businessName: string): Promise<string | undefined> {
    const base = slugify(businessName);
    if (!base) return undefined;
    for (let i = 0; i < 5; i++) {
      const candidate = i === 0 ? base : `${base}${i + 1}`;
      const taken = await this.repos.merchants.bySlug(candidate).catch(() => null);
      if (!taken) return candidate;
    }
    return undefined;
  }

  /**
   * Which vendor owns the number this message landed on. Our own number is not
   * a tenant, and neither is an unrecognised id — both fall through to the
   * platform behaviour rather than silently serving the wrong shop.
   */
  private async resolveTenant(phoneNumberId?: string): Promise<Merchant | null> {
    if (!phoneNumberId) return null;
    if (phoneNumberId === this.opts.platformPhoneNumberId) return null;
    return this.repos.merchants.byWaPhoneNumberId(phoneNumberId);
  }

  private async route(ctx: Ctx, text: string): Promise<string> {
    // 1) A shop deep link outranks EVERYTHING on our own number — including a
    //    conversation already in progress. A buyer who says "hi" first is put
    //    into vendor onboarding, and without this their `shop-mch_…` link was
    //    consumed as the answer to "what's your business name?", registering a
    //    merchant called "shop-mch_e562…" instead of opening the shop.
    //    Accepts a handle ("shop-circuitcity") or a raw id. A token that
    //    resolves to nothing falls through, so a business genuinely called
    //    "Shop Rite" still onboards under its own name.
    const shop = text.match(/^shop[-\s]+([\w-]+)/i);
    if (shop && !ctx.tenant) {
      const target = await this.resolveShop(shop[1]!);
      // Only claim the message if it really names a shop. A handle that matches
      // nothing falls through to normal routing, so a vendor whose business is
      // called "Shop Rite" still onboards instead of being told their own name
      // is an unavailable shop.
      if (target) return this.startBuyerFlow(ctx, target.id);
      if (/^mch_/i.test(shop[1]!)) {
        return "Sorry, that shop isn't available — please check the link.";
      }
    }

    // 2) Mid-conversation (onboarding or buying) → continue it.
    const state = this.convo.get(ctx.key);
    if (state) return this.continueConversation(ctx, text, state.step, state.data);

    // 3) On a vendor's own number the tenancy decides, not the message text.
    //    A `shop-<other>` deep link is deliberately ignored here (hence the
    //    `!ctx.tenant` guard above): a vendor's number must never hand a buyer
    //    a competitor's catalogue.
    // A photo from the vendor is a product picture, handled before any text
    // parsing: her caption is a description, not a command, and running it
    // through the command router would answer "Didn't get that" to a picture.
    if (ctx.image) {
      const owner = ctx.tenant ?? (await this.repos.merchants.byPhone(ctx.from));
      if (owner && ctx.from === owner.phone) {
        return this.attachPhoto(owner, ctx.image);
      }
    }

    if (ctx.tenant) {
      if (ctx.from === ctx.tenant.phone) return this.vendorCommand(ctx.tenant, text);
      return this.startBuyerFlow(ctx, ctx.tenant.id);
    }

    // 4) Registered merchant on our own number → vendor commands. Below the
    //    deep link so a vendor can shop other stores from their own phone.
    const merchant = await this.repos.merchants.byPhone(ctx.from);
    if (merchant) return this.vendorCommand(merchant, text);

    // 5) New unknown sender → greet + start onboarding.
    return this.startOnboarding(ctx);
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
  private startOnboarding(ctx: Ctx): string {
    this.convo.set(ctx.key, "onboard:business_name", {});
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
    ctx: Ctx,
    text: string,
    step: string,
    data: Record<string, unknown>,
  ): Promise<string> {
    const from = ctx.from;
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
        this.convo.set(ctx.key, "onboard:account_number", data);
        return `Nice to meet you, *${text}*! 🎉\n\nWhich bank account should we settle your money into?\nSend your *10-digit account number*.`;
      }
      case "onboard:account_number": {
        if (text.trim().toLowerCase() === "skip" && data.bankUnverified) {
          // She insists the number is right and we could not confirm it. Let
          // her through rather than trapping her, but the payout account will
          // fail later and `retry` exists for that.
          this.convo.set(ctx.key, "onboard:bank", data);
          return `No problem. Which bank is that?\n\n${bankMenu()}\n\nReply with the *number*.`;
        }
        const acct = text.replace(/\s/g, "");
        if (!/^\d{10}$/.test(acct)) {
          return "That doesn't look right — send your *10-digit* account number (numbers only).";
        }
        data.accountNumber = acct;
        this.convo.set(ctx.key, "onboard:bank", data);
        return `Which bank is that?\n\n${bankMenu()}\n\nReply with the *number*.`;
      }
      case "onboard:bank": {
        const bank = pickBank(text);
        if (!bank) return "Please reply with the number of your bank from the list.";
        data.bankId = bank.id;
        data.bankName = bank.name;

        // Check the account exists before going further. Ten digits taken on
        // trust is how a merchant reaches checkout and is told she "is not set
        // up to receive payments" — the number was wrong all along, and the
        // first person to find out was a buyer.
        const check = await this.payments.resolveBankAccount(
          bankCodeFor("paystack", bank.id),
          String(data.accountNumber),
        );
        // Only re-prompt when the provider actually looked and found nothing.
        // A rail with no resolver has checked nothing, and blocking on that
        // would make every merchant retype a good account number.
        if (check.supported && check.name === null) {
          // Null covers "no such account" AND "could not reach the provider".
          // Re-prompting once is right for the first; blocking onboarding on
          // the second would be worse than proceeding, so a second attempt at
          // the same number is allowed through.
          if (!data.bankUnverified) {
            data.bankUnverified = true;
            this.convo.set(ctx.key, "onboard:account_number", data);
            return [
              `We couldn't find account *${String(data.accountNumber)}* at *${bank.name}*.`,
              "",
              "Please send your *10-digit account number* again — or reply *skip* to carry on and fix it later.",
            ].join("\n");
          }
        } else if (check.name) {
          data.accountName = check.name;
        }

        this.convo.set(ctx.key, "onboard:crypto_settlement", data);
        return [
          "Almost done. Some buyers pay with *crypto* (USDC).",
          "",
          "How should we send you that money?",
          "",
          "*1* — 💵 As naira, straight into the bank account you just gave me _(recommended)_",
          "*2* — 🪙 As USDC, into a crypto wallet we create for you",
          "",
          "Reply *1* or *2*. Bank transfers always pay into your bank either way.",
        ].join("\n");
      }
      case "onboard:crypto_settlement": {
        const choice = text.trim();
        if (choice !== "1" && choice !== "2") {
          return "Reply *1* for naira in your bank, or *2* for USDC in a wallet.";
        }
        const settlement: "naira" | "usdc" = choice === "1" ? "naira" : "usdc";
        const bank = { id: String(data.bankId), name: String(data.bankName) };
        const merchant = await this.repos.merchants.create({
          id: ref("mch"),
          phone: from,
          businessName: String(data.businessName),
          slug: await this.freeSlug(String(data.businessName)),
          status: "active",
          kycState: "verified",
          cryptoEnabled: true,
          // The bank's identity, not one provider's code for it — each rail
          // translates via bankCodeFor when it needs its own scheme.
          settlementBankCode: bank.id,
          settlementAccountNumber: String(data.accountNumber),
          cryptoSettlement: settlement,
        });
        // Create the processor subaccount that bank payments settle into.
        // Without it the fiat rail refuses to issue an account number, because
        // money would otherwise land in the platform balance rather than hers.
        // Onboarding still completes if this fails — she can sell on crypto,
        // and `retryPayoutSetup` repairs the bank side — but it is logged loudly
        // because until it succeeds she cannot take a transfer.
        try {
          await this.payments.ensurePayoutAccount(merchant);
        } catch (err) {
          log.error(
            { err: (err as Error).message, merchantId: merchant.id },
            "payout subaccount creation failed during onboarding",
          );
        }

        // Generate an embedded wallet on whichever chain the crypto rail
        // actually settles on — an address on the wrong chain is not a smaller
        // problem than no address, it is funds sent somewhere she cannot reach.
        // Resilient: if generation fails, onboarding still succeeds (bank only).
        // Only when she chose to be paid in USDC. A wallet minted for someone
        // who wanted naira is a seed phrase she must guard for an account she
        // will never use — a liability handed over as if it were a feature.
        let walletLine = "";
        if (settlement === "usdc") try {
          const wallet = await this.wallets.generateForChain(this.opts.cryptoChain ?? "quai");
          await this.repos.merchants.setWalletSecrets(merchant.id, wallet.mnemonic, wallet.privateKey);
          await this.repos.merchants.update(merchant.id, { quaiAddress: wallet.address });
          const chainName = this.opts.cryptoChainName ?? (wallet.chain === "evm" ? "EVM" : "Quai");
          walletLine = `\n🪙 We created your ${chainName} wallet: ${wallet.address.slice(0, 10)}…${wallet.address.slice(-4)}\n⚠️ Back it up now: ${this.merchantOrigin()}/wallet (verify with the code we text you). It's the only way to control your crypto funds.`;
        } catch (err) {
          log.warn({ err: (err as Error).message }, "wallet generation failed during onboarding");
        }
        this.convo.clear(ctx.key);
        return [
          `✅ *${merchant.businessName}* is all set up!`,
          data.accountName
            ? `Payouts (bank): ${String(data.accountName)} — ${bank.name} ••••${String(data.accountNumber).slice(-4)}`
            : `Payouts (bank): ${bank.name} ••••${String(data.accountNumber).slice(-4)}`,
          settlement === "naira"
            ? "Crypto sales: converted and paid into that same bank account."
            : "Crypto sales: paid as USDC into your own wallet.",
          `${walletLine}`,
          "",
          "*Next:* add your first product",
          "_e.g._ *add Lipstick 5000*",
          "",
          "Then:",
          "• *link* — your shop link, and where to put it so buyers find it",
          `• 📊 *Your dashboard:* ${this.merchantOrigin()} — sign in with this number to add photos to your products, see orders and export your books`,
          "• *greeting* — a welcome message to paste into WhatsApp, so every new buyer gets your link automatically",
          "• *help* — everything else",
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
        this.convo.set(ctx.key, "buy:select_method", data);
        return [
          `You picked *${product?.name}* (${formatNaira(product?.price ?? 0)} ≈ ${koboToUsdcDisplay(product?.price ?? 0)}).`,
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
        this.convo.clear(ctx.key);

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
          // Built here rather than in the rail: MonnifyConfig has no base URL,
          // and /checkout/:orderId is a property of the app, not of Monnify.
          // The page renders the account number with a copy button and flips to
          // "paid" on its own — better than copying digits from a chat bubble.
          ...(this.opts.publicBaseUrl
            ? ["", "👉 *Or open it here:*", `${this.opts.publicBaseUrl}/checkout/${order.id}`]
            : []),
          "",
          "You'll get a receipt here the moment it lands.",
        ].join("\n");
      }
      default:
        this.convo.clear(ctx.key);
        // A stale step on a vendor's number must restart the SHOP, never
        // onboarding — the person on the other end is a buyer.
        if (ctx.tenant) return this.startBuyerFlow(ctx, ctx.tenant.id);
        return this.startOnboarding(ctx);
    }
  }

  // ---------------------------------------------------------------------------
  // Buyer storefront
  // ---------------------------------------------------------------------------
  private async startBuyerFlow(ctx: Ctx, merchantId: string): Promise<string> {
    const merchant = await this.repos.merchants.byId(merchantId);
    if (!merchant) return "Sorry, that shop isn't available — please check the link.";
    const products = await this.commerce.listProducts(merchantId);
    if (products.length === 0) {
      return `*${merchant.businessName}* hasn't added products yet. Check back soon!`;
    }
    this.convo.set(ctx.key, "buy:select_product", {
      merchantId,
      productIds: products.map((p) => p.id),
    });
    // Naira is the price; the QUAI figure is guidance, so it stays visually
    // secondary. A buyer paying on-chain still needs to know roughly what the
    // item costs in the token they actually hold.
    const list = products
      .map((p, i) => `${i + 1}) ${p.name} — ${formatNaira(p.price)}  _(≈ ${koboToUsdcDisplay(p.price)})_`)
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
  private async vendorCommand(merchant: Merchant, text: string): Promise<string> {
    const merchantId = merchant.id;
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
        return this.shopLink(merchant);
      case "greeting":
      case "welcome":
        return this.greetingMessage(merchant);
      case "connect":
        return this.connectNumber(merchant);
      case "ledger":
      case "sales":
      case "balance":
      case "books":
        return this.salesLedger(merchantId, merchant.phone);
      default:
        return `Didn't get that. ${this.menu()}`;
    }
  }

  /**
   * Hand the vendor their Embedded Signup link, so buyers can message THEIR
   * number instead of ours. Everything else about their shop is unchanged —
   * this only moves where the conversation happens.
   */
  private connectNumber(merchant: Merchant): string {
    if (merchant.waPhoneNumberId) {
      return [
        "✅ Your own WhatsApp number is already connected.",
        ...(merchant.waDisplayPhone ? [`Buyers reach you on ${merchant.waDisplayPhone}.`] : []),
        "",
        "Type *link* for the link to share.",
      ].join("\n");
    }
    if (!this.signup?.configured) {
      return [
        "Connecting your own WhatsApp number isn't switched on yet.",
        "",
        "For now buyers reach your shop through our number — type *link* to get yours.",
      ].join("\n");
    }
    return [
      "📱 *Sell from your own WhatsApp number*",
      "",
      "Tap below to connect your WhatsApp Business number. Buyers will then message *you* directly, and your shop replies for you.",
      "",
      this.signup.signupUrl(merchant.id),
      "",
      "You'll need your business's Facebook login. Takes about 2 minutes.",
    ].join("\n");
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
      "• *add <name> <price>* — _e.g. add Lipstick 5000_",
      "",
      "*🔗 Get buyers*",
      "• *link* — your shop link + where to put it",
      "• *greeting* — ready-made welcome message to paste into WhatsApp",
      "• *connect* — sell from your OWN WhatsApp number",
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

  /**
   * Once a vendor is on their own number the link is simply *their* number:
   * any message to it opens their catalogue, so it needs no `?text=shop-<id>`
   * payload — and a buyer who saves the contact still lands in the right shop.
   */
  /**
   * The links a vendor shares to get buyers.
   *
   * The web storefront leads. It is the only link that shows a browsable
   * catalogue with pictures and prices before the buyer has to talk to
   * anybody, and unlike the WhatsApp routes it needs no Meta review to work
   * for a vendor on her own number. The chat link follows it, because plenty
   * of buyers would still rather ask a question than tap Add to cart.
   */
  /**
   * A welcome message she can paste into WhatsApp as-is.
   *
   * Telling a vendor to "set a greeting message" leaves her staring at an
   * empty box wondering what to write, which is its own reason the link never
   * gets used. This hands her finished copy with her own shop name and link
   * already in it, so the job is copy, paste, save.
   */
  private greetingMessage(merchant: Merchant): string {
    const handle = merchant.slug ?? merchant.id;
    if (!this.opts.publicBaseUrl) {
      return "Your shop link isn't ready yet — send *link* once your shop is set up.";
    }
    const shopUrl = `${this.opts.publicBaseUrl}/s/${handle}`;
    return [
      "👋 *Your welcome message* — copy everything between the lines:",
      "",
      "──────────",
      `Hi! Welcome to ${merchant.businessName} 🛍️`,
      "",
      "See everything we have, with prices:",
      shopUrl,
      "",
      "Tap any item to buy — pay by transfer or card, and we'll confirm straight away.",
      "──────────",
      "",
      "Now paste it into WhatsApp:",
      "*Settings → Business tools → Greeting message*",
      "Turn it on, and set it to send to *everyone* who messages you for the first time.",
      "",
      "_Send *link* for the other places to put your shop link._",
    ].join("\n");
  }

  /**
   * Her shop link, and — the part that actually matters — where to put it.
   *
   * A vendor handed a URL and no instructions leaves it in the chat and never
   * uses it, which is how a working storefront ends up with no visitors. The
   * places listed are all ones she controls herself in apps she already has:
   * none of them need Embedded Signup, Meta review, or anything from us. That
   * is deliberate — it means she can be selling today rather than whenever
   * review clears.
   */
  private shopLink(merchant: Merchant): string {
    const handle = merchant.slug ?? merchant.id;
    const shopUrl = this.opts.publicBaseUrl
      ? `${this.opts.publicBaseUrl}/s/${handle}`
      : "";

    if (!shopUrl) {
      // Nothing to share yet, so say what is missing rather than printing a
      // half-formed link she would paste into her profile.
      return `Your shop id: *shop-${handle}*\nBuyers message this number with that to see your catalogue.`;
    }

    const lines: string[] = [
      "🛒 *Your shop link*",
      shopUrl,
      "",
      "Buyers see your pictures and prices, and pay by transfer or card. Copy it and put it everywhere people already find you 👇",
      "",
      "*1. WhatsApp greeting message*",
      "Settings → Business tools → Greeting message.",
      "Paste the link there and every NEW person who messages you gets it automatically, before you even reply.",
      "",
      "*2. Your WhatsApp profile*",
      "Settings → Business profile → Website. This one is always visible on your profile, not just on first contact.",
      "",
      "*3. Instagram bio*",
      "Edit profile → Website, or add it to your Link in bio.",
      "",
      "*4. Facebook page*",
      "Edit page info → Website. You can also pin a post with the link.",
    ];

    let hasChatLink = false;
    const own = digits(merchant.waDisplayPhone);
    if (merchant.waPhoneNumberId && own) {
      hasChatLink = true;
      lines.push(
        "",
        "💬 Buyers can also chat you directly: " + `https://wa.me/${own}`,
      );
    } else if (this.opts.waNumber) {
      hasChatLink = true;
      // Prefer the handle: buyers read these aloud and retype them, and
      // "shop-mch_e562196b4b76ad5b" is unusable the moment it leaves a tap.
      lines.push(
        "",
        "💬 Or to order by chat: " + `https://wa.me/${this.opts.waNumber}?text=shop-${handle}`,
      );
    }

    // With no chat route configured the handle still has to reach her: it is
    // what a buyer types to this number to open her catalogue, and the one
    // part of all this she may need to read down a phone line.
    if (!hasChatLink) {
      lines.push("", `Your shop id is *shop-${handle}*.`);
    }

    lines.push(
      "",
      "_Send *link* anytime to get this again._",
    );
    return lines.join("\n");
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
    // Remember it, so the next photo she sends needs no id typed out. A vendor
    // adding stock takes the picture right after naming the thing; asking her
    // to quote a uuid back is how product photos never get added at all.
    this.awaitingPhoto.set(merchantId, { productId: product.id, name: product.name });
    return [
      `✅ Added *${product.name}* at ${formatNaira(product.price)}`,
      `ID: ${product.id}`,
      "",
      "📸 *Send a photo now* and I'll put it on this product.",
      "",
      "Or add another with *add <name> <price>*, then *link* to share your shop.",
    ].join("\n");
  }

  /**
   * Attach a photo she just sent to the product she just added.
   *
   * Falls back to her newest product without one, so a picture sent a beat
   * late still lands somewhere sensible rather than being dropped with an
   * error she has to decode.
   */
  private async attachPhoto(
    merchant: Merchant,
    image: { mediaId: string; caption?: string },
  ): Promise<string> {
    if (!this.media) {
      return "I can't take photos just yet — add one from your dashboard instead.";
    }

    let target = this.awaitingPhoto.get(merchant.id) ?? null;
    if (!target) {
      const products = await this.repos.products.listByMerchant(merchant.id);
      const candidate = [...products].reverse().find((p) => !p.imageUrl);
      if (candidate) target = { productId: candidate.id, name: candidate.name };
    }
    if (!target) {
      return [
        "Nice photo! I'm not sure which product it belongs to though.",
        "",
        "Add the product first — _e.g._ *add Egusi Soup 3000* — then send the picture.",
      ].join("\n");
    }

    const fetched = await this.media.fetch(image.mediaId);
    if (!fetched) {
      return [
        `I couldn't save that photo for *${target.name}*.`,
        "",
        "Try again with a smaller picture (under 5MB), or add it from your dashboard.",
      ].join("\n");
    }

    await this.commerce.setProductImage(target.productId, fetched);
    this.awaitingPhoto.delete(merchant.id);
    return [
      `📸 Photo added to *${target.name}* — buyers will see it on your shop page.`,
      "",
      "Add another product with *add <name> <price>*, or *link* to share your shop.",
    ].join("\n");
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
      `Full books + CSV export: ${this.merchantOrigin()} (sign in with this number)`,
    ].join("\n");
  }

  /** Where a MERCHANT signs in. Falls back to the buyer origin when unset. */
  private merchantOrigin(): string {
    return this.opts.merchantBaseUrl || this.opts.publicBaseUrl;
  }

  /** Always answer on the number the message came in on. */
  private async reply(ctx: Ctx, message: string): Promise<void> {
    if (!message) return; // suppressed — never send an empty WhatsApp message
    await this.transport.send(ctx.from, message, { phoneNumberId: ctx.phoneNumberId });
  }
}

/**
 * Conversation keys are namespaced by the number the message arrived on: the
 * same buyer can be mid-purchase with two different vendors, and on a shared
 * key the second shop would resume the first shop's product list.
 */
function convKey(from: string, phoneNumberId?: string): string {
  return `${phoneNumberId ?? "platform"}:${from}`;
}

/** Digits only, for building a `wa.me/<digits>` link from a display number. */
function digits(phone?: string): string {
  return (phone ?? "").replace(/\D/g, "");
}
