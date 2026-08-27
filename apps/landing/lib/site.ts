/**
 * Every piece of copy on the landing page lives here.
 *
 * Anything marked [PLACEHOLDER] is a business decision, not a product fact —
 * replace it before the site goes live.
 */

/** wa.me digits for the Rhodium bot. Mirrors WHATSAPP_WA_NUMBER in render.yaml. */
const WHATSAPP_NUMBER =
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "2348036803974";

const WHATSAPP_GREETING = "Hi Rhodium — I want to start selling on WhatsApp.";

export const site = {
  name: "Rhodium",
  tagline: "Sell on WhatsApp. Get paid without the screenshot.",
  description:
    "Rhodium turns your WhatsApp chat into a checkout. Bank transfer or crypto, auto-confirmed in seconds, every sale booked in naira.",
  whatsappUrl: `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
    WHATSAPP_GREETING,
  )}`,
  email: "hello@userhodium.xyz", // [PLACEHOLDER]
  /** Where data-protection and legal requests go — cited in the policies. */
  legalEmail: "admin@foniolabs.xyz",
  /** Canonical marketing origin. Meta's app settings must match this exactly. */
  origin: "https://www.userhodium.xyz",
  /**
   * The operating company. Rhodium is the product; Fonio Labs is the legal
   * entity that Meta's Business Verification checks against, and the data
   * controller named in the policies. Stating it on the site is what lets a
   * reviewer connect a "Fonio Labs" business portfolio to a Rhodium website.
   */
  company: "Fonio Labs",
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
    delta: "+12 orders",
    note: "Ledger updates the moment a payment confirms", // illustrative UI
  },
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
    title: "Crypto Rail on Quai",
    body: "Take USDT or QUAI from a BlipPay wallet. Funds move buyer to merchant atomically, in a single transaction.",
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
    title: "Traction Dashboard",
    body: "GMV, transaction count, unique buyers and the split between rails — live, and exportable as CSV.",
  },
] as const;

export const howItWorks = [
  {
    step: "01",
    title: "Share the product",
    body: "Send your catalogue in WhatsApp the way you already do. Rhodium turns the message into a real order.",
  },
  {
    step: "02",
    title: "Buyer pays their way",
    body: "A dedicated account number for a bank transfer, or a checkout link that opens inside their BlipPay wallet.",
  },
  {
    step: "03",
    title: "Everyone gets told",
    body: "The payment confirms itself. You're notified, the buyer is receipted, and the sale is in your books — in naira.",
  },
] as const;

export const benefits = [
  {
    title: "We never hold your money",
    body: "Bank transfers settle to your own account; crypto goes wallet to wallet in the same transaction. There is no custody path in the code — every payment rail is required to name you as the settlement target.",
  },
  {
    title: "A replayed payment can't double-count",
    body: "Confirmations are idempotent on the provider's event id and the on-chain transaction hash. If a webhook fires twice, your ledger still shows one sale.",
  },
  {
    title: "Books that reconcile themselves",
    body: "A daily job compares every confirmed payment against the ledger and flags drift before you ever notice it. Export the statement as CSV whenever your accountant asks.",
  },
] as const;

/**
 * [PLACEHOLDER] Pricing is illustrative — set real numbers before launch.
 */
export const plans = [
  {
    name: "Starter",
    blurb: "Everything you need to take your first WhatsApp payment.",
    price: "₦0",
    period: "/ month",
    cta: "Open on WhatsApp",
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
    cta: "Open on WhatsApp",
    featured: true,
    features: [
      "Unlimited confirmed orders",
      "Crypto rail on Quai and BlipPay",
      "Live traction dashboard",
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
export const integrations = [
  { name: "WhatsApp", note: "Cloud API", mark: "whatsapp" },
  { name: "Quai", note: "Network", mark: "quai" },
  { name: "BlipPay", note: "Wallet", mark: "blippay" },
  { name: "Monnify", note: "Bank rail", mark: "monnify" },
  { name: "USDT", note: "Stable value", mark: "usdt" },
  { name: "NDPR", note: "Compliance", mark: "ndpr" },
] as const;

export const footerColumns = [
  {
    title: "Product",
    links: [
      { label: "WhatsApp checkout", href: "#features" },
      { label: "Crypto rail", href: "#features" },
      { label: "Naira ledger", href: "#benefits" },
      { label: "Traction dashboard", href: "#features" },
    ],
  },
  {
    title: "Rails",
    links: [
      { label: "Bank transfer", href: "#features" },
      { label: "Quai Network", href: "#integrations" },
      { label: "BlipPay wallet", href: "#integrations" },
      { label: "No-custody design", href: "#benefits" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "How it works", href: "#how" },
      { label: "Pricing", href: "#pricing" },
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms of Service", href: "/terms" },
    ],
  },
] as const;
