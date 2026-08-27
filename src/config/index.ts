/**
 * Central, validated configuration. Fail fast on bad config in prod;
 * fall back to safe mock defaults in dev/test so the system is runnable
 * with zero external credentials (the seams are built, the features flagged).
 */
import { z } from "zod";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v == null ? def : v === "true" || v === "1"));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.string().default("info"),

  DATABASE_URL: z.string().optional(),

  FIELD_ENCRYPTION_KEY: z
    .string()
    .default("0".repeat(64)),
  APP_SECRET: z.string().default("dev-secret-change-me"),

  FIAT_ADAPTER_MODE: z.enum(["mock", "live"]).default("mock"),

  // --- Monnify (bank rail) ---
  MONNIFY_API_KEY: z.string().optional().default(""),
  MONNIFY_SECRET_KEY: z.string().optional().default(""),
  MONNIFY_CONTRACT_CODE: z.string().optional().default(""),
  MONNIFY_BASE_URL: z.string().default("https://sandbox.monnify.com"),
  MONNIFY_WALLET_ACCOUNT_NUMBER: z.string().optional().default(""),

  // --- OnSwitch (crypto→naira off-ramp): buyer pays USDT/USDC, vendor gets naira ---
  ONSWITCH_ADAPTER_MODE: z.enum(["mock", "live"]).default("mock"),
  ONSWITCH_SERVICE_KEY: z.string().optional().default(""),
  ONSWITCH_BASE_URL: z.string().default("https://api.onswitch.xyz"),
  // Asset buyers pay in — "chain:token". OnSwitch off-ramp supports USDT on
  // tron/ethereum/polygon (not base). tron:usdt (USDT-TRC20) is cheapest + most
  // popular in Nigeria. NOTE: this is USDT on those chains — NOT Quai's USDT.
  ONSWITCH_ASSET: z.string().default("tron:usdt"),

  FEATURE_STABLECOIN_ENABLED: bool(false),

  // --- Quai Network + BlipPay crypto rail (buildathon) ---
  FEATURE_QUAI_ENABLED: bool(true),
  QUAI_ADAPTER_MODE: z.enum(["mock", "live"]).default("mock"),
  // Orchard testnet (per the Quai buildathon starter guide).
  QUAI_RPC_URL: z.string().optional().default("https://orchard.rpc.quai.network/cyprus1"),
  QUAI_CHAIN_ID: z.string().default("15000"),
  QUAI_EXPLORER_URL: z.string().default("https://orchard.quaiscan.io"),
  QUAI_CONTRACT_ADDRESS: z.string().optional().default(""),
  QUAI_USDT_ADDRESS: z.string().optional().default(""),
  // Which asset buyers pay: 'native' QUAI (simplest for the testnet demo) or
  // 'usdt' (ERC-20 stablecoin). Native needs only faucet QUAI.
  QUAI_PAYMENT_ASSET: z.enum(["native", "usdt"]).default("usdt"),
  // BUYER-facing origin: checkout links, BlipPay deep links, rail callbacks.
  PUBLIC_BASE_URL: z.string().default("http://localhost:3000"),
  // MERCHANT-facing origin: dashboard, wallet backup, OAuth callback. Both
  // hostnames reach the same service; they differ only in what a reader sees.
  // A buyer paying should see a payments domain, not an admin one. Empty falls
  // back to PUBLIC_BASE_URL so single-domain deployments need no extra config.
  MERCHANT_BASE_URL: z.string().optional().default(""),
  // FX oracle stubs. [VALIDATE] — swap for a real price feed in prod.
  FX_NGN_PER_USD: z.coerce.number().default(1600),
  // Fallback only — the live CoinGecko rate wins when FX_LIVE_RATES is on.
  // Kept as a floor so a dead price feed never stops a sale.
  FX_NGN_PER_QUAI: z.coerce.number().default(16.5),
  FX_LIVE_RATES: bool(true),
  FX_RATE_TTL_MS: z.coerce.number().default(5 * 60 * 1000),

  WHATSAPP_MODE: z.enum(["mock", "live"]).default("mock"),
  WHATSAPP_ACCESS_TOKEN: z.string().optional().default(""),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(""),
  WHATSAPP_VERIFY_TOKEN: z.string().default("rhodium-verify"),
  WHATSAPP_APP_SECRET: z.string().optional().default(""),
  // Bot's own number in wa.me digit form (e.g. 15551405536) for buyer shop links.
  WHATSAPP_WA_NUMBER: z.string().optional().default(""),
  // --- Embedded Signup: vendors connect their OWN WhatsApp number ---
  WHATSAPP_APP_ID: z.string().optional().default(""),
  WHATSAPP_CONFIG_ID: z.string().optional().default(""),
  // Meta-HOSTED Embedded Signup landing page. When set, `connect` hands the
  // vendor this instead of a self-built /dialog/oauth link: Meta renders the
  // whole onboarding journey (including Coexistence, which keeps the vendor's
  // WhatsApp Business app alive on the same number), and we only handle the
  // redirect back. Empty => fall back to the URL we construct ourselves.
  WHATSAPP_SIGNUP_URL: z.string().optional().default(""),
  // Defaults to `${MERCHANT_BASE_URL}/oauth/whatsapp/callback` — must match the
  // redirect URI registered on the Meta app exactly.
  WHATSAPP_OAUTH_REDIRECT_URI: z.string().optional().default(""),

  OBJECT_STORE_MODE: z.enum(["local", "s3"]).default("local"),
  OBJECT_STORE_BUCKET: z.string().default("rhodium-media"),
  S3_ENDPOINT: z.string().optional().default(""),
  S3_ACCESS_KEY: z.string().optional().default(""),
  S3_SECRET_KEY: z.string().optional().default(""),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.message}`);
  }
  const cfg = parsed.data;

  // On platforms that inject their own public URL (Render, Railway), use it for
  // BlipPay checkout deep links unless PUBLIC_BASE_URL was set explicitly.
  const platformUrl = env.RENDER_EXTERNAL_URL ?? env.RAILWAY_PUBLIC_DOMAIN;
  if (platformUrl && cfg.PUBLIC_BASE_URL === "http://localhost:3000") {
    cfg.PUBLIC_BASE_URL = platformUrl.startsWith("http")
      ? platformUrl
      : `https://${platformUrl}`;
  }

  if (!cfg.MERCHANT_BASE_URL) cfg.MERCHANT_BASE_URL = cfg.PUBLIC_BASE_URL;

  // The vendor completes Embedded Signup, so the callback belongs on the
  // merchant origin. Must match the Meta app's registered URI character for
  // character or the exchange fails.
  if (!cfg.WHATSAPP_OAUTH_REDIRECT_URI) {
    cfg.WHATSAPP_OAUTH_REDIRECT_URI = `${cfg.MERCHANT_BASE_URL}/oauth/whatsapp/callback`;
  }

  // Guardrails: in production, live external calls must have real credentials.
  if (cfg.NODE_ENV === "production") {
    if (cfg.FIAT_ADAPTER_MODE === "live" && (!cfg.MONNIFY_API_KEY || !cfg.MONNIFY_SECRET_KEY)) {
      throw new Error("FIAT_ADAPTER_MODE=live requires MONNIFY_API_KEY + MONNIFY_SECRET_KEY");
    }
    if (cfg.WHATSAPP_MODE === "live" && !cfg.WHATSAPP_ACCESS_TOKEN) {
      throw new Error("WHATSAPP_MODE=live requires WHATSAPP_ACCESS_TOKEN");
    }
    if (cfg.FIELD_ENCRYPTION_KEY === "0".repeat(64)) {
      throw new Error("FIELD_ENCRYPTION_KEY must be set in production");
    }
  }
  cached = cfg;
  return cfg;
}

export function resetConfigCache(): void {
  cached = null;
}
