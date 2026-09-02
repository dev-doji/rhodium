import type {
  PaymentRail,
  PaymentInstruction,
  PaymentEvent,
  PaymentStatusResult,
  WebhookPayload,
  SettlementTarget,
} from "./types.js";
import type { Merchant, Order, RailId } from "../domain/types.js";
import { MockEvmChain } from "./mock-evm-chain.js";
import {
  PAID_TOPIC,
  orderIdToBytes32,
  addressToTopic,
  wordToDecimal,
  topicToAddress,
} from "./evm-abi.js";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import type { Kobo } from "../lib/money.js";

const log = logger("evm-stable-rail");

export interface EvmStableConfig {
  mode: "mock" | "live";
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorerUrl: string;
  contractAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  /** Naira per 1 USD. A stablecoin is pegged, so this is the whole conversion. */
  ngnPerUsd: number;
  publicBaseUrl: string;
}

/**
 * Stablecoin payments on any EVM chain — Arbitrum by default.
 *
 * The buyer pays USDC/USDT through RhodiumPay.payToken(), which moves the token
 * buyer -> merchant in one transaction and emits Paid(orderId, ...). The
 * contract never holds a balance, so this is the crypto twin of the bank DVA:
 * merchant-direct, no custody.
 *
 * Nothing here names Arbitrum. Chain id, RPC, explorer and token all come from
 * config, so pointing at Base or Polygon is env vars rather than a new adapter.
 */
export class EvmStableRail implements PaymentRail {
  readonly id: RailId = "evm_stable";
  readonly kind = "crypto" as const;
  readonly mock?: MockEvmChain;

  constructor(private cfg: EvmStableConfig) {
    if (cfg.mode === "mock") this.mock = new MockEvmChain();
  }

  /** NO CUSTODY: the merchant's own wallet is the settlement target. */
  settlementTarget(merchant: Merchant): SettlementTarget {
    return {
      kind: "wallet",
      walletAddress: merchant.quaiAddress, // merchant's self-custody EVM address
      owner: "merchant",
    };
  }

  /**
   * Naira -> stablecoin base units.
   *
   * A stablecoin is ~1 USD, so there is no price oracle on this path — the
   * volatility that forces one exists only for native tokens.
   *
   * DECIMALS ARE SIX for USDC and USDT, not eighteen. Treating them as 18 would
   * ask the buyer for a million times the intended amount, and their wallet
   * would show a plausible-looking number while doing it.
   */
  private toBaseUnits(amount: Kobo): string {
    const naira = amount / 100;
    const usd = naira / this.cfg.ngnPerUsd;
    const units = BigInt(Math.round(usd * 10 ** this.cfg.tokenDecimals));
    return units.toString();
  }

  async createPaymentInstruction(order: Order, merchant: Merchant): Promise<PaymentInstruction> {
    const merchantAddress = merchant.quaiAddress;
    if (!merchantAddress) {
      throw new AppError(
        "merchant has no wallet address for crypto settlement",
        "merchant_no_wallet",
        409,
      );
    }
    return {
      railId: this.id,
      instructionType: "crypto",
      providerRef: order.id,
      amount: order.amount,
      chainId: String(this.cfg.chainId),
      contractAddress: this.cfg.contractAddress || "0xRhodiumPayMock",
      method: "payToken",
      tokenAddress: this.cfg.tokenAddress,
      tokenSymbol: this.cfg.tokenSymbol,
      cryptoAmount: this.toBaseUnits(order.amount),
      merchantAddress,
      orderIdBytes32: orderIdToBytes32(order.id),
      checkoutUrl: `${this.cfg.publicBaseUrl}/checkout/${order.id}`,
      network: this.cfg.chainName,
    };
  }

  /**
   * The buyer's wallet reports a tx hash; we verify it against the chain rather
   * than trusting the claim. A payment is confirmed by a Paid log carrying THIS
   * order's id hash — not by anyone saying they paid.
   */
  async handleWebhook(raw: WebhookPayload): Promise<PaymentEvent> {
    const body = JSON.parse(raw.rawBody || "{}") as { orderId?: string; txHash?: string };
    if (!body.orderId || !body.txHash) {
      throw new AppError("orderId and txHash required", "bad_request", 400);
    }
    const expected = orderIdToBytes32(body.orderId);

    if (this.cfg.mode === "mock") {
      const hit = this.mock!.byTxHash(body.txHash);
      if (!hit || hit.orderIdBytes32 !== expected) {
        return {
          railId: this.id,
          providerRef: body.orderId,
          status: "ignored",
          idempotencyKey: `evm:${body.txHash}:nomatch`,
        };
      }
      return this.confirmed(body.orderId, hit.amount, body.txHash);
    }

    const receipt = await this.rpc<{ logs?: EvmLog[]; status?: string }>(
      "eth_getTransactionReceipt",
      [body.txHash],
    );
    if (!receipt || receipt.status !== "0x1") {
      return {
        railId: this.id,
        providerRef: body.orderId,
        status: "ignored",
        idempotencyKey: `evm:${body.txHash}:unmined`,
      };
    }
    const paid = this.findPaidLog(receipt.logs ?? [], expected);
    if (!paid) {
      // Mined, but it did not pay THIS order. Never confirm on a hash alone.
      log.warn({ txHash: body.txHash, orderId: body.orderId }, "no matching Paid log");
      return {
        railId: this.id,
        providerRef: body.orderId,
        status: "ignored",
        idempotencyKey: `evm:${body.txHash}:nolog`,
      };
    }
    return this.confirmed(body.orderId, paid.amount, body.txHash);
  }

  async verifyPayment(providerRef: string): Promise<PaymentStatusResult> {
    const expected = orderIdToBytes32(providerRef);
    if (this.cfg.mode === "mock") {
      const hit = this.mock!.findByOrderIdHash(expected);
      return hit
        ? { providerRef, status: "confirmed", amount: this.toKobo(hit.amount), rawEventId: hit.txHash }
        : { providerRef, status: "pending" };
    }
    // Poll fallback: scan the contract's Paid logs for this order's id hash.
    const logs = await this.rpc<EvmLog[]>("eth_getLogs", [
      {
        address: this.cfg.contractAddress,
        topics: [PAID_TOPIC, expected],
        fromBlock: "earliest",
        toBlock: "latest",
      },
    ]).catch(() => null);
    const paid = this.findPaidLog(logs ?? [], expected);
    return paid
      ? { providerRef, status: "confirmed", amount: this.toKobo(paid.amount), rawEventId: paid.txHash }
      : { providerRef, status: "pending" };
  }

  // --- internals -------------------------------------------------------------

  private confirmed(orderId: string, baseUnits: string, txHash: string): PaymentEvent {
    return {
      railId: this.id,
      providerRef: orderId,
      status: "confirmed",
      amount: this.toKobo(baseUnits),
      // The TRANSACTION is the idempotency anchor: the same hash submitted twice
      // must credit the ledger once.
      idempotencyKey: `evm:${txHash.toLowerCase()}`,
      rawEventId: txHash,
    };
  }

  /** Stablecoin base units back to kobo, for the amount-integrity check. */
  private toKobo(baseUnits: string): Kobo {
    const usd = Number(BigInt(baseUnits)) / 10 ** this.cfg.tokenDecimals;
    return Math.round(usd * this.cfg.ngnPerUsd * 100);
  }

  private findPaidLog(logs: EvmLog[], expectedOrderIdHash: string):
    | { amount: string; merchant: string; txHash: string }
    | null {
    const wantToken = addressToTopic(this.cfg.tokenAddress);
    for (const l of logs) {
      if ((l.address ?? "").toLowerCase() !== this.cfg.contractAddress.toLowerCase()) continue;
      const [topic0, orderTopic, merchantTopic] = l.topics ?? [];
      if (topic0?.toLowerCase() !== PAID_TOPIC.toLowerCase()) continue;
      if (orderTopic?.toLowerCase() !== expectedOrderIdHash.toLowerCase()) continue;
      // data = (address token, uint256 amount, address payer)
      const tokenWord = `0x${(l.data ?? "").replace(/^0x/, "").slice(0, 64)}`;
      if (tokenWord.toLowerCase() !== wantToken.toLowerCase()) {
        // Right order, wrong token — someone paid in something we did not price.
        log.warn({ expected: this.cfg.tokenAddress }, "Paid log for an unexpected token");
        continue;
      }
      return {
        amount: wordToDecimal(l.data ?? "", 1),
        merchant: topicToAddress(merchantTopic ?? ""),
        txHash: l.transactionHash ?? "",
      };
    }
    return null;
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(this.cfg.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) throw new AppError(`evm rpc ${res.status}`, "provider_error", 502);
    const body = (await res.json()) as { result?: T; error?: { message?: string } };
    if (body.error) throw new AppError(`evm rpc: ${body.error.message}`, "provider_error", 502);
    return body.result as T;
  }
}

interface EvmLog {
  address?: string;
  topics?: string[];
  data?: string;
  transactionHash?: string;
}
