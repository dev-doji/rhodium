import type { PaymentRail } from "./types.js";
import type { CryptoSettlement, RailId, RailKind } from "../domain/types.js";
import { MonnifyFiatRail } from "./monnify-fiat-rail.js";
import { PaystackFiatRail } from "./paystack-fiat-rail.js";
import { StablecoinRail } from "./stablecoin-rail.js";
import { EvmStableRail } from "./evm-stable-rail.js";
import { OnSwitchRail } from "./onswitch-rail.js";
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

  /**
   * Like `get`, but returns null for a rail that is no longer registered.
   *
   * Retiring a rail does not retire the rows it wrote. Orders and payments
   * created on it keep their railId forever, and a background job walking the
   * payment table must not crash on a decade-old row from a provider we
   * stopped using. Read paths use this; anything creating a NEW payment still
   * uses `get`, because there a missing rail is a genuine misconfiguration.
   */
  find(id: RailId): PaymentRail | null {
    return this.rails.get(id) ?? null;
  }

  /**
   * The crypto rail for a given merchant.
   *
   * Not a single global choice, because the two rails pay her in different
   * things: OnSwitch off-ramps to her bank in naira and needs no wallet, while
   * the EVM rail sends USDC to a wallet she has to keep a seed phrase for.
   * That is her decision, taken at onboarding, so it is read from the merchant
   * rather than from config.
   *
   * With no preference recorded — a merchant onboarded before the question
   * existed — it falls back to the first registered crypto rail, which is the
   * platform default.
   */
  crypto(settlement?: CryptoSettlement): PaymentRail {
    if (settlement === "usdc") {
      const evm = this.rails.get("evm_stable");
      if (evm) return evm;
    }
    if (settlement === "naira") {
      const off = this.rails.get("onswitch");
      if (off) return off;
    }
    const rail = this.all().find((r) => r.kind === "crypto");
    if (!rail) throw new NotFoundError("crypto rail");
    return rail;
  }

  /** Pick a rail by order kind, honouring the merchant's crypto preference. */
  forKind(kind: RailKind, settlement?: CryptoSettlement): PaymentRail {
    return kind === "crypto" ? this.crypto(settlement) : this.fiat();
  }

  all(): PaymentRail[] {
    return [...this.rails.values()];
  }
}

export function buildRegistry(cfg: AppConfig): RailRegistry {
  // Bank rail. BOTH providers are registered whatever FIAT_PROVIDER says, so a
  // provider outage is one env var to revert rather than a deploy — and so an
  // in-flight order created under the old provider can still be confirmed by
  // its webhook after the switch.
  const registry = new RailRegistry(cfg.FIAT_PROVIDER);
  registry.register(
    new PaystackFiatRail({
      mode: cfg.FIAT_ADAPTER_MODE,
      secretKey: cfg.PAYSTACK_SECRET_KEY,
      baseUrl: cfg.PAYSTACK_BASE_URL,
      dvaBank: cfg.PAYSTACK_DVA_BANK,
    }),
  );
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

  // Crypto rail. When the EVM stablecoin rail is enabled it is registered FIRST,
  // so `crypto()` — which returns the first crypto rail found — routes new
  // orders to it. Same pattern as keeping Monnify registered behind Paystack.
  if (cfg.FEATURE_EVM_STABLE_ENABLED) {
    registry.register(
      new EvmStableRail({
        mode: cfg.EVM_ADAPTER_MODE,
        chainId: cfg.EVM_CHAIN_ID,
        chainName: cfg.EVM_CHAIN_NAME,
        rpcUrl: cfg.EVM_RPC_URL,
        explorerUrl: cfg.EVM_EXPLORER_URL,
        contractAddress: cfg.EVM_CONTRACT_ADDRESS,
        tokenAddress: cfg.EVM_TOKEN_ADDRESS,
        tokenSymbol: cfg.EVM_TOKEN_SYMBOL,
        tokenDecimals: cfg.EVM_TOKEN_DECIMALS,
        ngnPerUsd: cfg.FX_NGN_PER_USD,
        publicBaseUrl: cfg.PUBLIC_BASE_URL,
      }),
    );
  }

  // Quai has been retired in favour of the EVM rail on Arbitrum. Rows written
  // by it keep their railId forever, which is why read paths use
  // `registry.find` and tolerate a rail that is no longer here.
  {
    registry.register(new StablecoinRail(cfg.FEATURE_STABLECOIN_ENABLED));
  }

  // Off-ramp rail: OnSwitch (buyer pays stablecoin → merchant paid in naira).
  registry.register(
    new OnSwitchRail({
      mode: cfg.ONSWITCH_ADAPTER_MODE,
      serviceKey: cfg.ONSWITCH_SERVICE_KEY,
      baseUrl: cfg.ONSWITCH_BASE_URL,
      asset: cfg.ONSWITCH_ASSET,
      callbackUrl: `${cfg.PUBLIC_BASE_URL}/webhooks/rails/onswitch`,
    }),
  );

  return registry;
}
