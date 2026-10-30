import type {
  PaymentRail,
  PaymentInstruction,
  PaymentEvent,
  PaymentStatusResult,
  RailOptions,
  WebhookPayload,
  SettlementTarget,
} from "./types.js";
import type { Merchant, Order, RailId } from "../domain/types.js";
import {
  MockOneClickServer,
  formatUnits,
  type OneClickQuote,
  type OneClickQuoteRequest,
  type OneClickStatus,
  type OneClickStatusResponse,
} from "./mock-oneclick-server.js";
import { NearRpc, ftTransfersTo, type NearTxSource } from "./near-rpc.js";
import { NEAR_PAY_ASSETS, isRefundAddressFor, nearPayAsset } from "./near-assets.js";
import { AppError, ValidationError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import type { Kobo } from "../lib/money.js";

const log = logger("near-intents-rail");

export interface NearIntentsConfig {
  mode: "mock" | "live";
  oneClickBaseUrl: string;
  oneClickApiKey: string;
  rpcUrl: string;
  explorerUrl: string;
  usdcContract: string;
  usdcDecimals: number;
  /** See NEAR_TX_SENDER_HINT in config. */
  txSenderHint: string;
  quoteTtlMinutes: number;
  slippageBps: number;
  appFeeBps: number;
  feeRecipient: string;
  /** Naira per USD, read live — the same oracle the catalogue quotes with. */
  ngnPerUsd: () => number;
  publicBaseUrl: string;
  now?: () => Date;
}

/** What a buyer is shown while a NEAR payment is in flight. */
export type NearSwapPhase = "waiting" | "deposit_seen" | "swapping" | "paid" | "refunded" | "failed";

/**
 * NEAR Intents via 1Click: the buyer pays with whatever they hold, on whatever
 * chain, and the merchant receives exact-amount USDC in her OWN NEAR account.
 *
 * NO CUSTODY. The quote's `recipient` is always the merchant's account and its
 * `refundTo` is always the buyer's own address. Rhodium holds no key that can
 * move either. The deposit address is unique per quote, so it identifies the
 * order the way a dedicated bank account does — it is the providerRef.
 *
 * NEVER CONFIRM ON A CLAIM. 1Click reporting SUCCESS is a hint. The payment is
 * confirmed by the NEAR chain itself showing the USDC contract logging a
 * transfer to the merchant's account, for at least the quoted amount.
 */
export class NearIntentsRail implements PaymentRail {
  readonly id: RailId = "near_intents";
  readonly kind = "crypto" as const;
  readonly mock?: MockOneClickServer;
  private chain: NearTxSource;

  constructor(private cfg: NearIntentsConfig) {
    if (cfg.mode === "mock") this.mock = new MockOneClickServer(cfg.usdcContract);
    this.chain = this.mock ?? new NearRpc(cfg.rpcUrl);
  }

  /** NO CUSTODY: USDC lands in the merchant's own NEAR account. */
  settlementTarget(merchant: Merchant): SettlementTarget {
    return { kind: "wallet", walletAddress: merchant.nearAccountId, owner: "merchant" };
  }

  /** The assets this rail will quote, for the checkout's picker. */
  payAssets() {
    return NEAR_PAY_ASSETS.map((a) => ({
      assetId: a.assetId,
      label: a.label,
      symbol: a.symbol,
      chain: a.chain,
      chainName: a.chainName,
      decimals: a.decimals,
      // A wallet button for a mock deposit address would offer to send real
      // mainnet money to a string nobody owns. Same rule as the off-ramp.
      ...(a.evm && this.cfg.mode === "live" ? { evmChainId: a.evm.chainId } : {}),
    }));
  }

  /**
   * Naira -> USDC base units, through the same oracle the buyer was quoted in.
   * SIX decimals: USDC on NEAR is not eighteen.
   */
  private toUsdcUnits(amount: Kobo): bigint {
    const usd = amount / 100 / this.cfg.ngnPerUsd();
    return BigInt(Math.round(usd * 10 ** this.cfg.usdcDecimals));
  }

  async createPaymentInstruction(
    order: Order,
    merchant: Merchant,
    _buyer?: { phone?: string; name?: string },
    opts?: RailOptions,
  ): Promise<PaymentInstruction> {
    const recipient = merchant.nearAccountId;
    if (!recipient) {
      throw new AppError(
        "merchant has no NEAR account to receive USDC",
        "merchant_no_near_account",
        409,
        { merchantId: merchant.id },
      );
    }
    const asset = opts?.originAsset ? nearPayAsset(opts.originAsset) : undefined;
    if (!asset) {
      throw new ValidationError("choose what you're paying with", {
        originAsset: opts?.originAsset ?? null,
      });
    }
    const refundTo = opts?.refundTo?.trim() ?? "";
    if (!isRefundAddressFor(asset.chain, refundTo)) {
      throw new ValidationError(
        `enter your own ${asset.chainName} address — it's where a refund goes if the payment can't complete`,
        { chain: asset.chain },
      );
    }

    const units = this.toUsdcUnits(order.amount);
    if (units <= 0n) throw new ValidationError("order amount is too small to pay in USDC");
    const now = this.cfg.now?.() ?? new Date();
    const request: OneClickQuoteRequest = {
      originAsset: asset.assetId,
      destinationAsset: `nep141:${this.cfg.usdcContract}`,
      amount: units.toString(),
      recipient,
      refundTo,
      deadline: new Date(now.getTime() + this.cfg.quoteTtlMinutes * 60_000).toISOString(),
      slippageTolerance: this.cfg.slippageBps,
    };
    const quote = this.mock ? this.mock.quote(request) : await this.liveQuote(request);
    const usdcDisplay = formatUnits(units, this.cfg.usdcDecimals);

    return {
      railId: this.id,
      instructionType: "crypto",
      providerRef: quote.depositAddress,
      amount: order.amount,
      depositAddress: quote.depositAddress,
      ...(quote.depositMemo ? { depositMemo: quote.depositMemo } : {}),
      network: asset.chainName,
      originAsset: asset.assetId,
      originChain: asset.chain,
      tokenSymbol: asset.symbol,
      // A decimal figure, as on the off-ramp: the checkout's wallet button
      // converts it with `tokenDecimals`, and it is what a buyer types.
      cryptoAmount: quote.amountInFormatted,
      cryptoAmountDisplay: quote.amountInFormatted,
      merchantAddress: recipient,
      destinationAsset: request.destinationAsset,
      settleUnits: units.toString(),
      settlesTo: `${usdcDisplay} USDC → ${recipient}`,
      refundTo,
      expiresAt: new Date(quote.deadline),
      checkoutUrl: `${this.cfg.publicBaseUrl}/checkout/${order.id}`,
      ...(asset.evm && this.cfg.mode === "live" && /^0x[0-9a-fA-F]{40}$/.test(quote.depositAddress)
        ? {
            walletChainId: asset.evm.chainId,
            tokenAddress: asset.evm.tokenAddress,
            tokenDecimals: asset.decimals,
          }
        : {}),
    };
  }

  /**
   * The buyer's wallet may report its deposit hash. 1Click accepts it as a
   * hint that speeds detection; it proves nothing, so this never confirms.
   * Confirmation is verifyPayment's job, against the chain.
   */
  async handleWebhook(raw: WebhookPayload): Promise<PaymentEvent> {
    const body = JSON.parse(raw.rawBody || "{}") as { depositAddress?: string; txHash?: string };
    if (!body.depositAddress || !body.txHash) {
      throw new AppError("depositAddress and txHash required", "bad_request", 400);
    }
    try {
      if (this.mock) this.mock.submitDeposit(body.depositAddress, body.txHash);
      else
        await this.api("/v0/deposit/submit", {
          method: "POST",
          body: JSON.stringify({ txHash: body.txHash, depositAddress: body.depositAddress }),
        });
    } catch (err) {
      // Only an optimisation. The poller finds the deposit without it.
      log.warn({ err: (err as Error).message, depositAddress: body.depositAddress }, "deposit submit failed");
    }
    return {
      railId: this.id,
      providerRef: body.depositAddress,
      status: "ignored",
      idempotencyKey: `near:submit:${body.txHash}`,
    };
  }

  /**
   * Ask 1Click where the swap is, and on SUCCESS check the chain.
   *
   * `issued` is the instruction as quoted. With it, the amount is judged in
   * USDC against the exact units the merchant was promised, rather than
   * converted back to naira at whatever the oracle says NOW — a rate move
   * between quote and settlement would otherwise read as an underpayment.
   */
  async verifyPayment(providerRef: string, issued?: PaymentInstruction): Promise<PaymentStatusResult> {
    let st: OneClickStatusResponse;
    try {
      st = await this.swapStatus(providerRef, issued?.depositMemo);
    } catch (err) {
      // Could not check is not unpaid — same reasoning as EvmStableRail.
      log.error({ err: (err as Error).message, providerRef }, "1Click status failed — NOT proven unpaid");
      return { providerRef, status: "pending" };
    }

    if (st.status === "REFUNDED" || st.status === "FAILED") return { providerRef, status: "failed" };
    if (st.status !== "SUCCESS") return { providerRef, status: "pending" };

    const expectedTo = issued?.merchantAddress ?? st.quoteResponse.quoteRequest.recipient;
    const hashes = st.swapDetails.destinationChainTxHashes.map((h) => h.hash).filter(Boolean);
    if (!hashes.length) {
      log.warn({ providerRef }, "1Click SUCCESS with no destination tx — waiting for one");
      return { providerRef, status: "pending" };
    }

    const received = new Map<string, bigint>();
    try {
      for (const hash of hashes) {
        const tx = await this.chain.txStatus(hash, this.cfg.txSenderHint);
        for (const [to, amt] of ftTransfersTo(tx, this.cfg.usdcContract)) {
          received.set(to, (received.get(to) ?? 0n) + amt);
        }
      }
    } catch (err) {
      log.error(
        { err: (err as Error).message, providerRef, hashes },
        "NEAR tx lookup failed — 1Click says SUCCESS but the chain was not checked; staying pending",
      );
      return { providerRef, status: "pending" };
    }

    // Report who the CHAIN says was paid. If USDC went anywhere but the
    // quoted account, name that account: the orchestrator's recipient check
    // then refuses to credit the order and records why.
    const toMerchant = received.get(expectedTo) ?? 0n;
    let recipient = expectedTo;
    let units = toMerchant;
    if (toMerchant === 0n) {
      const other = [...received.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1))[0];
      if (!other) {
        log.warn({ providerRef, hashes }, "1Click SUCCESS but no USDC transfer on chain");
        return { providerRef, status: "pending" };
      }
      [recipient, units] = other;
    }

    return {
      providerRef,
      status: "confirmed",
      amount: this.toKobo(units, issued),
      rawEventId: hashes[0],
      recipient,
    };
  }

  /** Where a payment is, in words a buyer's screen can show. */
  async phase(providerRef: string, depositMemo?: string): Promise<NearSwapPhase> {
    const st = await this.swapStatus(providerRef, depositMemo);
    const map: Record<OneClickStatus, NearSwapPhase> = {
      PENDING_DEPOSIT: "waiting",
      INCOMPLETE_DEPOSIT: "waiting",
      KNOWN_DEPOSIT_TX: "deposit_seen",
      PROCESSING: "swapping",
      SUCCESS: "paid",
      REFUNDED: "refunded",
      FAILED: "failed",
    };
    return map[st.status] ?? "waiting";
  }

  explorerTxUrl(hash: string): string {
    return `${this.cfg.explorerUrl}/txns/${hash}`;
  }

  explorerAccountUrl(accountId: string): string {
    return `${this.cfg.explorerUrl}/address/${accountId}`;
  }

  /**
   * Whether a NEAR account exists, before a merchant is told she can be paid
   * there. USDC sent to an account that does not exist is refunded at best.
   * Mock mode accepts any well-formed id.
   */
  async accountExists(accountId: string): Promise<boolean> {
    if (this.mock) return true;
    return (this.chain as NearRpc).accountExists(accountId);
  }

  // --- internals -------------------------------------------------------------

  /**
   * USDC received -> kobo for the orchestrator's amount check.
   *
   * Pro rata against what was promised when we know it: receiving the full
   * quoted units is exactly the order's naira, and half of it is half. Only
   * a row with no snapshot falls back to the live rate.
   */
  private toKobo(units: bigint, issued?: PaymentInstruction): Kobo {
    if (issued?.settleUnits && BigInt(issued.settleUnits) > 0n) {
      const promised = BigInt(issued.settleUnits);
      if (units >= promised) return issued.amount;
      return Number((units * BigInt(issued.amount)) / promised);
    }
    const usd = Number(units) / 10 ** this.cfg.usdcDecimals;
    return Math.round(usd * this.cfg.ngnPerUsd() * 100);
  }

  private async swapStatus(depositAddress: string, depositMemo?: string): Promise<OneClickStatusResponse> {
    if (this.mock) return this.mock.status(depositAddress);
    const q = new URLSearchParams({ depositAddress });
    if (depositMemo) q.set("depositMemo", depositMemo);
    return (await this.api(`/v0/status?${q}`, { method: "GET" })) as OneClickStatusResponse;
  }

  private async liveQuote(request: OneClickQuoteRequest): Promise<OneClickQuote> {
    const body = {
      dry: false,
      swapType: "EXACT_OUTPUT",
      depositType: "ORIGIN_CHAIN",
      refundType: "ORIGIN_CHAIN",
      recipientType: "DESTINATION_CHAIN",
      referral: "rhodium",
      ...request,
      ...(this.cfg.appFeeBps > 0
        ? { appFees: [{ recipient: this.cfg.feeRecipient, fee: this.cfg.appFeeBps }] }
        : {}),
    };
    const res = (await this.api("/v0/quote", { method: "POST", body: JSON.stringify(body) })) as {
      quote?: OneClickQuote;
    };
    if (!res.quote?.depositAddress) {
      throw new AppError("1Click returned a quote with no deposit address", "provider_error", 502);
    }
    return res.quote;
  }

  private async api(path: string, init: RequestInit): Promise<unknown> {
    const res = await fetch(`${this.cfg.oneClickBaseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(this.cfg.oneClickApiKey ? { "X-API-Key": this.cfg.oneClickApiKey } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      log.error({ path, status: res.status, text: text.slice(0, 300) }, "1Click api error");
      // 1Click explains a 400 in `message` — "amount too low", "unsupported
      // asset" — and that sentence is the whole diagnosis.
      let detail = text.slice(0, 300);
      try {
        detail = (JSON.parse(text) as { message?: string }).message ?? detail;
      } catch {
        /* not JSON */
      }
      throw new AppError(`1Click ${path.split("?")[0]} ${res.status}: ${detail}`, "provider_error", 502);
    }
    return res.json();
  }
}
