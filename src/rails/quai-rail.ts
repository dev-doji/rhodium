import type {
  PaymentRail,
  PaymentInstruction,
  PaymentEvent,
  PaymentStatusResult,
  WebhookPayload,
  SettlementTarget,
} from "./types.js";
import type { Merchant, Order, RailId } from "../domain/types.js";
import { MockQuaiChain, type PaidLog } from "./mock-quai-chain.js";
import {
  koboToUsdtUnits,
  usdtUnitsToKobo,
  koboToQuaiWei,
  quaiWeiToKobo,
} from "../lib/fx.js";
import {
  PAID_TOPIC0,
  orderIdToBytes32,
  decodePaidLog,
  isNativeToken,
  type RpcReceipt,
} from "./quai-abi.js";
import { AppError, ValidationError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

const log = logger("quai-rail");

export interface QuaiConfig {
  mode: "mock" | "live";
  asset: "native" | "usdt";
  chainId: string;
  contractAddress: string;
  usdtAddress: string;
  rpcUrl: string;
  publicBaseUrl: string;
}

/**
 * Quai / BlipPay crypto rail — same PaymentRail interface as the fiat rail.
 * Buyers pay through the RhodiumPay forwarder (funds go merchant-direct, no
 * custody); the `Paid` event's orderId is the match key. In `live` mode the rail
 * reads the tx receipt from Orchard and decodes the event ITSELF (no external
 * indexer). Confirmations normalize to kobo so the naira ledger is reused.
 */
export class QuaiRail implements PaymentRail {
  readonly id: RailId = "quai";
  readonly kind = "crypto" as const;
  readonly chain?: MockQuaiChain;

  constructor(private cfg: QuaiConfig) {
    if (cfg.mode === "mock") this.chain = new MockQuaiChain();
  }

  settlementTarget(merchant: Merchant): SettlementTarget {
    return { kind: "wallet", walletAddress: merchant.quaiAddress, owner: "merchant" };
  }

  private isNative(): boolean {
    return this.cfg.asset === "native";
  }

  async createPaymentInstruction(
    order: Order,
    merchant: Merchant,
  ): Promise<PaymentInstruction> {
    if (!merchant.quaiAddress) {
      throw new AppError(
        "merchant has no Quai wallet — cannot settle crypto merchant-direct",
        "missing_wallet",
        409,
        { merchantId: merchant.id },
      );
    }
    const native = this.isNative();
    const cryptoAmount = native
      ? koboToQuaiWei(order.amount)
      : koboToUsdtUnits(order.amount);
    const checkoutUrl = `${this.cfg.publicBaseUrl}/checkout/${order.id}`;
    return {
      railId: this.id,
      instructionType: "crypto",
      providerRef: order.id,
      amount: order.amount, // kobo (naira price)
      chainId: this.cfg.chainId,
      contractAddress: this.cfg.contractAddress || "0xRhodiumPayMock",
      method: native ? "payNative" : "payToken",
      tokenAddress: native ? undefined : this.cfg.usdtAddress || "0xUSDTMock",
      tokenSymbol: native ? "QUAI" : "USDT",
      cryptoAmount,
      merchantAddress: merchant.quaiAddress,
      orderIdBytes32: orderIdToBytes32(order.id),
      checkoutUrl,
      deepLink: `blip://browser?url=${encodeURIComponent(checkoutUrl)}`,
    };
  }

  async handleWebhook(raw: WebhookPayload): Promise<PaymentEvent> {
    const body = JSON.parse(raw.rawBody) as { txHash?: string; orderId?: string };
    if (this.cfg.mode === "mock") return this.handleMock(body);
    return this.handleLive(body);
  }

  async verifyPayment(providerRef: string): Promise<PaymentStatusResult> {
    if (this.cfg.mode === "mock") {
      const l = this.chain!.getLogByOrder(providerRef);
      if (!l) return { providerRef, status: "pending" };
      return { providerRef, status: "confirmed", amount: this.toKobo(l.token, l.amount) };
    }
    // Live: filter the chain for our Paid event by orderId topic.
    const logs = await this.rpc<{ address: string; topics: string[]; data: string }[]>(
      "eth_getLogs",
      [
        {
          address: this.cfg.contractAddress,
          topics: [PAID_TOPIC0, orderIdToBytes32(providerRef)],
          fromBlock: "earliest",
          toBlock: "latest",
        },
      ],
    ).catch(() => null);
    const decoded =
      logs && decodePaidLog({ logs }, this.cfg.contractAddress, orderIdToBytes32(providerRef));
    if (!decoded) return { providerRef, status: "pending" };
    return { providerRef, status: "confirmed", amount: this.toKobo(decoded.token, decoded.amount) };
  }

  // --- mock ---
  private handleMock(body: { txHash?: string }): PaymentEvent {
    if (!body.txHash) throw new ValidationError("txHash required");
    const l = this.chain!.getLogByTx(body.txHash);
    if (!l || !l.blockConfirmed) {
      return { railId: this.id, providerRef: "unknown", status: "ignored", idempotencyKey: `quai:${body.txHash}` };
    }
    return this.toEvent(l.orderId, l.token, BigInt(l.amount), l.txHash);
  }

  // --- live: read the receipt from Orchard and decode the Paid event ---
  private async handleLive(body: { txHash?: string; orderId?: string }): Promise<PaymentEvent> {
    if (!body.txHash || !body.orderId) {
      throw new ValidationError("live confirm needs txHash and orderId");
    }
    const receipt = await this.pollReceipt(body.txHash);
    if (!receipt) {
      return { railId: this.id, providerRef: body.orderId, status: "ignored", idempotencyKey: `quai:${body.txHash}` };
    }
    const decoded = decodePaidLog(receipt, this.cfg.contractAddress, orderIdToBytes32(body.orderId));
    if (!decoded) {
      return { railId: this.id, providerRef: body.orderId, status: "ignored", idempotencyKey: `quai:${body.txHash}` };
    }
    return this.toEvent(body.orderId, decoded.token, decoded.amount, body.txHash);
  }

  private toEvent(orderId: string, token: string, amount: bigint, txHash: string): PaymentEvent {
    log.info({ txHash, orderId }, "quai Paid confirmed");
    return {
      railId: this.id,
      providerRef: orderId,
      status: "confirmed",
      amount: this.toKobo(token, amount),
      idempotencyKey: `quai:${txHash}`, // tx hash is chain-unique => replay-safe
      rawEventId: txHash,
    };
  }

  private toKobo(token: string, amount: bigint | string): number {
    return isNativeToken(token) ? quaiWeiToKobo(amount) : usdtUnitsToKobo(String(amount));
  }

  private async pollReceipt(txHash: string, tries = 10, delayMs = 2000): Promise<RpcReceipt | null> {
    for (let i = 0; i < tries; i++) {
      const receipt = await this.rpc<RpcReceipt | null>("eth_getTransactionReceipt", [txHash]).catch(() => null);
      if (receipt && receipt.logs) return receipt;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(this.cfg.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) throw new AppError(`quai rpc ${res.status}`, "rpc_error", 502);
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new AppError(body.error.message, "rpc_error", 502);
    return body.result as T;
  }
}

// Re-export for the mock chain amount convenience.
export type { PaidLog };
