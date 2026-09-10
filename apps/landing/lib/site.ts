/**
 * Every piece of copy on the landing page lives here.
 *
 * Anything marked [PLACEHOLDER] is a business decision, not a product fact —
 * replace it before the site goes live.
 */

/**
 * wa.me digits for the Rhodium bot. Mirrors WHATSAPP_WA_NUMBER on Render, and
 * is set as NEXT_PUBLIC_WHATSAPP_NUMBER on Cloudflare Pages.
 *
 * Deliberately has no default. The number has already been changed once, and a
 * baked-in fallback is not a safety net here — it is the failure: the build
 * succeeds, every button still looks right, and every buyer who taps one is
 * sent to a number that no longer answers, while the vendor side keeps working
 * so nobody notices. Failing the build is the loud, cheap version of that.
 */
const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
if (!WHATSAPP_NUMBER) {
  throw new Error(
    "NEXT_PUBLIC_WHATSAPP_NUMBER is not set. Set it to the bot's wa.me digits " +
      "(the same value as WHATSAPP_WA_NUMBER on Render) in the Cloudflare Pages " +
      "environment, or in .env.local for a local build.",
  );
}

const WHATSAPP_GREETING = "Hi Rhodium — I want to start selling on WhatsApp.";

/**
 * Where returning vendors sign in. The dashboard is served by the API on the
 * merchant origin, not by this static site, so it cannot be a relative link.
 * Falls back to the marketing origin's /dashboard, which is right for a
 * single-domain deployment.
 */
const DASHBOARD_URL =
  process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "https://app.userhodium.xyz";

export const site = {
  name: "Rhodium",
  tagline: "Sell on WhatsApp. Get paid without the screenshot.",
  description:
    "Rhodium turns your WhatsApp chat into a checkout. Bank transfer or crypto, auto-confirmed in seconds, every sale booked in naira.",
  whatsappUrl: `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
    WHATSAPP_GREETING,
  )}`,
  /** Vendors register by messaging the bot — there is no separate signup form. */
  registerUrl: `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
    "Hi Rhodium — I want to register my shop.",
  )}`,
  dashboardUrl: DASHBOARD_URL,
  /**
   * Real, and monitored: an ImprovMX alias on the verified domain, forwarding
   * to the operator's inbox. It was a placeholder on a domain with no mailbox
   * behind it — a contact address that silently discards what is sent to it.
   */
  email: "support@userhodium.xyz",
  /** Where data-protection and legal requests go — cited in the policies. */
  legalEmail: "support@userhodium.xyz",
  /** Canonical marketing origin. Meta's app settings must match this exactly. */
  origin: "https://www.userhodium.xyz",
  /**
   * The operating company. Rhodium is the product; Fonio Labs is the legal
   * entity that Meta's Business Verification checks against, and the data
   * controller named in the policies. Stating it on the site is what lets a
   * reviewer connect a "Fonio Labs" business portfolio to a Rhodium website.
   *
   * Keep this the EXACT registered name. Meta matches it against the CAC
   * certificate character for character; dropping "Limited" to read better
   * would break the match this line exists to provide.
   */
  company: "Fonio Labs Limited",
  companyUrl: "https://www.foniolabs.xyz/",
} as const;

export const nav = [
  { label: "Home", href: "#top" },
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how" },
  { label: "Pricing", href: "#pricing" },
] as const;

/** The three claims under the hero buttons — all true of the product today. */
export const trustPoints = [
  "No custody — money settles to your own account",
  "Auto-confirmed, no screenshots",
  "One naira ledger across both rails",
] as const;

/** Hero bento stats. Product facts, not vanity metrics. */
export const heroStats = {
  confirm: {
    value: "~2s",
    label: "From buyer's transfer to your confirmation",
  },
  rails: {
    value: "2 rails",
    label: "Bank transfer and crypto, one checkout",
  },
  custody: {
    value: "₦0",
    label: "Held by us. Ever. Funds settle straight to you.",
  },
  ledger: {
    title: "Today's sales",
    amount: "₦184,500",
    // The same day's takings in the other rail's unit, at ~₦1,524/USDC. Both
    // hero cards use that one rate, so a reader converting between them gets
    // the same answer twice.
    inUsdc: "≈ 121 USDC",
    delta: "+12 orders",
    note: "Ledger updates the moment a payment confirms", // illustrative UI
  },
  // The alert a merchant actually gets. Invented shop, invented order — a real
  // merchant's takings do not belong on a marketing page, and the card says
  // "example" on its face for the same reason.
  sale: {
    shop: "Ada's Kitchen",
    // A crypto sale: the buyer sends stablecoin, the merchant banks naira.
    amount: "8.20 USDC",
    fiat: "₦12,500",
    item: "2 × jollof plate",
    when: "now",
  },
} as const;

/**
 * The "mission" band: image on one side, claim plus a checklist on the other.
 * Every line here is a fact about the product as it stands today, not an
 * aspiration — this section sits directly under the hero, where an overclaim
 * would be most expensive.
 */
export const mission = {
  label: "What we do",
  title: "Your chat is already the shop. We made it the checkout.",
  body: [
    "Nigerian sellers close deals in WhatsApp every day, then lose an hour chasing transfer screenshots and typing sales into a notebook that never balances.",
    "Rhodium keeps the conversation exactly where it is and does the awkward half for you: the asking, the confirming, the receipting, and the booking.",
  ],
  points: [
    "Each order gets its own account number",
    "Transfers confirm themselves in about two seconds",
    "Or take USDC on Arbitrum, settled to your bank in naira",
    "Receipts go out without you lifting a finger",
    "Every sale lands in one naira ledger",
  ],
} as const;

/** The "story" band — why this exists, in plain language. */
export const story = {
  label: "Why we built it",
  title: "Built for the seller, not the spreadsheet.",
  body: [
    "The screenshot problem is not a payments problem, it is a trust problem. A seller cannot tell a real transfer from a doctored one, so she either ships and hopes, or makes a paying customer wait.",
    "So we started at the money and worked backwards. Payments confirm against the rail itself, never against an image. Funds settle to the seller's own account — there is no custody path anywhere in the code to settle anywhere else.",
  ],
} as const;

/** The three numbers on the dark band. Product facts; deliberately not vanity
 *  metrics, because we have not launched and invented traction is a liability. */
export const proofStats = [
  { value: "~2s", label: "Transfer to confirmation" },
  { value: "2", label: "Rails, one checkout" },
  { value: "\u20a60", label: "Ever held by us" },
] as const;

/** Closing full-bleed photo band. */
export const closingCta = {
  title: "Start selling on WhatsApp today.",
  body: "Message the bot and you can take your first confirmed payment in the next few minutes. No app to install, no store to build.",
  cta: "Create your shop — free",
} as const;

export const features = [
  {
    icon: "MessageCircle",
    title: "WhatsApp Checkout",
    body: "List a product, send a payment request, and let the buyer pay without ever leaving the chat they're already in.",
  },
  {
    icon: "ShieldCheck",
    title: "Auto-Confirmed Transfers",
    body: "Each order gets its own account number. The transfer confirms itself — no screenshot, no “I've sent it, check now”.",
  },
  {
    icon: "Coins",
    title: "Stablecoins on Arbitrum",
    body: "Take USDC or USDT from any wallet the buyer already has. You choose where it lands: naira in your bank, or USDC in your own wallet.",
  },
  {
    icon: "BookOpen",
    title: "One Naira Ledger",
    body: "Both rails land in the same append-only ledger, denominated in kobo. Integers only — never floats, never drift.",
  },
  {
    icon: "Receipt",
    title: "Receipts & Restock",
    body: "The buyer gets a receipt, you get a confirmation, and stock decrements itself. All from one confirmed payment.",
  },
  {
    icon: "TrendingUp",
    title: "Your Numbers, Yours",
    body: "Sales, orders and running balance for your shop alone — with the whole ledger as CSV whenever your accountant asks.",
  },
] as const;

export const howItWorks = [
  {
    step: "01",
    title: "Share the product",
    body: "Send your catalogue in WhatsApp the way you already do. Rhodium turns the message into a real order and a checkout link to send back.",
  },
  {
    step: "02",
    title: "Buyer pays their way",
    body: "One checkout, two rails: a dedicated account number for a bank transfer, or USDC and USDT on Arbitrum, paid from the buyer's own wallet.",
  },
  {
    step: "03",
    title: "Everyone gets told",
    body: "The payment confirms itself against the bank or the chain — never against a screenshot. You're notified, the buyer gets a receipt to save or share, stock comes down, and the sale is booked in naira.",
  },
] as const;

export const benefits = [
  {
    title: "We never hold your money",
    body: "Bank transfers settle to your own account. Crypto moves buyer to merchant in a single transaction when you take USDC, or through a licensed off-ramp straight to your bank when you take naira. There is no custody path in the code — every payment rail is required to name you as the settlement target.",
  },
  {
    title: "A replayed payment can't double-count",
    body: "Confirmations are idempotent on the provider's event id and the on-chain transaction hash. If a webhook fires twice, or the same transfer is seen by both the webhook and the poller, your ledger still shows one sale.",
  },
  {
    title: "Books that reconcile themselves",
    body: "A daily job compares every confirmed payment against the ledger and flags drift before you ever notice it. Export the statement as CSV whenever your accountant asks.",
  },
] as const;

/**
 * PRICING IS NOT CONFIRMED.
 *
 * These numbers were placeholders in code while being presented to visitors as
 * real. Either set the real ones or keep `pricingProvisional` true, which puts
 * a visible note on the section — a price a visitor relies on and we do not
 * honour is the kind of claim this whole page is being cleaned up to avoid.
 */
export const pricingProvisional = true;

export const plans = [
  {
    name: "Starter",
    blurb: "Everything you need to take your first WhatsApp payment.",
    price: "₦0",
    period: "/ month",
    cta: "Create your shop — free",
    featured: false,
    features: [
      "Up to 50 confirmed orders a month",
      "WhatsApp catalogue and checkout",
      "Auto-confirmed bank transfers",
      "Naira ledger with CSV export",
    ],
  },
  {
    name: "Growth",
    blurb: "For sellers running both rails and watching the numbers.",
    price: "₦9,500",
    period: "/ month",
    cta: "Create your shop — free",
    featured: true,
    features: [
      "Unlimited confirmed orders",
      "Stablecoin rail: USDC and USDT on Arbitrum",
      "Crypto settled to your bank in naira",
      "Daily automatic reconciliation",
    ],
  },
] as const;

export const enterprisePlan = {
  name: "Enterprise",
  blurb:
    "Running a marketplace, a co-operative, or many merchant lines? We'll shape the rails, limits and reporting around your operation.",
  cta: "Talk to us on WhatsApp",
} as const;

/** `mark` keys map to the logo marks in `components/logos.tsx`. */
/**
 * What the product actually runs on today.
 *
 * This list claimed Quai and BlipPay, both retired, and Monnify, whose keys
 * are not even set — a visitor could reasonably read those as live
 * partnerships. It also showed NDPR as a badge beside them, which reads as a
 * certification rather than a law we comply with; that belongs in the privacy
 * policy, where it is explained, not in a logo row implying accreditation.
 */
export const integrations = [
  { name: "WhatsApp", note: "Cloud API", mark: "whatsapp" },
  { name: "Paystack", note: "Bank rail", mark: "paystack" },
  { name: "Arbitrum", note: "Network", mark: "arbitrum" },
  { name: "USDC", note: "Stablecoin", mark: "usdc" },
  { name: "OnSwitch", note: "Crypto to naira", mark: "onswitch" },
] as const;

export const footerColumns = [
  {
    title: "Product",
    links: [
      { label: "WhatsApp checkout", href: "#features" },
      { label: "Stablecoin rail", href: "#features" },
      { label: "Naira ledger", href: "#benefits" },
      { label: "Receipts", href: "#features" },
    ],
  },
  {
    title: "Rails",
    links: [
      { label: "Bank transfer", href: "#features" },
      { label: "Arbitrum", href: "#integrations" },
      { label: "Crypto to naira", href: "#integrations" },
      { label: "No-custody design", href: "#benefits" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "How it works", href: "#how" },
      { label: "Pricing", href: "#pricing" },
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Cookie Policy", href: "/cookies" },
      { label: "Terms of Service", href: "/terms" },
    ],
  },
] as const;
