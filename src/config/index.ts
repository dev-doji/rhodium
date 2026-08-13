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
  // Public base URL used to build BlipPay checkout deep links.
  PUBLIC_BASE_URL: z.string().default("http://localhost:3000"),
  // FX oracle stubs. [VALIDATE] — swap for a real price feed in prod.
  FX_NGN_PER_USD: z.coerce.number().default(1600),
  FX_NGN_PER_QUAI: z.coerce.number().default(5000),

  WHATSAPP_MODE: z.enum(["mock", "live"]).default("mock"),
  WHATSAPP_ACCESS_TOKEN: z.string().optional().default(""),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(""),
  WHATSAPP_VERIFY_TOKEN: z.string().default("rhodium-verify"),
  WHATSAPP_APP_SECRET: z.string().optional().default(""),
  // Bot's own number in wa.me digit form (e.g. 15551405536) for buyer shop links.
  WHATSAPP_WA_NUMBER: z.string().optional().default(""),

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
