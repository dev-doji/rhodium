import type { PaymentRail } from "./types.js";
import type { RailId, RailKind } from "../domain/types.js";
import { MonnifyFiatRail } from "./monnify-fiat-rail.js";
import { StablecoinRail } from "./stablecoin-rail.js";
import { QuaiRail } from "./quai-rail.js";
import { NotFoundError } from "../lib/errors.js";
import type { AppConfig } from "../config/index.js";

/**
 * Rail registry — the anti-lock-in seam (§1.4 feature 8). Services only ever ask
 * the registry for "the fiat rail" or a rail by id; adding Moniepoint later, or
 * flipping stablecoin on, is a registry change, not a service rewrite.
 */
export class RailRegistry {
  private rails = new Map<RailId, PaymentRail>();

  constructor(private defaultFiatId: RailId) {}

  register(rail: PaymentRail): this {
    this.rails.set(rail.id, rail);
    return this;
  }

  get(id: RailId): PaymentRail {
    const rail = this.rails.get(id);
    if (!rail) throw new NotFoundError("payment rail", { id });
    return rail;
  }

  /** The live fiat rail used for the MVP magic moment. */
  fiat(): PaymentRail {
    return this.get(this.defaultFiatId);
  }

  /** The active crypto rail (Quai/BlipPay). */
  crypto(): PaymentRail {
    const rail = this.all().find((r) => r.kind === "crypto");
    if (!rail) throw new NotFoundError("crypto rail");
    return rail;
  }

  /** Pick a rail by order kind: fiat → bank transfer, crypto → Quai/BlipPay. */
  forKind(kind: RailKind): PaymentRail {
    return kind === "crypto" ? this.crypto() : this.fiat();
  }

  all(): PaymentRail[] {
    return [...this.rails.values()];
  }
}

export function buildRegistry(cfg: AppConfig): RailRegistry {
  // Bank rail: Monnify (reserved accounts → naira settlement, no custody by us).
  const registry = new RailRegistry("monnify");
  registry.register(
    new MonnifyFiatRail({
      mode: cfg.FIAT_ADAPTER_MODE,
      apiKey: cfg.MONNIFY_API_KEY,
      secretKey: cfg.MONNIFY_SECRET_KEY,
      contractCode: cfg.MONNIFY_CONTRACT_CODE,
      baseUrl: cfg.MONNIFY_BASE_URL,
      walletAccountNumber: cfg.MONNIFY_WALLET_ACCOUNT_NUMBER,
    }),
  );

  // Crypto rail: the fleshed-out Quai/BlipPay adapter when enabled; otherwise
  // the dark stablecoin stub keeps the seam present but refusing.
  if (cfg.FEATURE_QUAI_ENABLED) {
    registry.register(
      new QuaiRail({
        mode: cfg.QUAI_ADAPTER_MODE,
        asset: cfg.QUAI_PAYMENT_ASSET,
        chainId: cfg.QUAI_CHAIN_ID,
        contractAddress: cfg.QUAI_CONTRACT_ADDRESS,
        usdtAddress: cfg.QUAI_USDT_ADDRESS,
        rpcUrl: cfg.QUAI_RPC_URL,
        publicBaseUrl: cfg.PUBLIC_BASE_URL,
      }),
    );
  } else {
    registry.register(new StablecoinRail(cfg.FEATURE_STABLECOIN_ENABLED));
  }

  return registry;
}
