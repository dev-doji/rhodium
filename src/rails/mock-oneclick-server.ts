/**
 * In-process simulator of NEAR Intents' 1Click API, plus the NEAR chain
 * behind it: quote (returns a unique deposit address), status, and a `pay()`
 * that plays the buyer depositing and a solver delivering USDC.
 *
 * `pay()` fabricates a NEAR transaction with the same NEP-141 event lines a
 * real USDC delivery logs, so the rail's on-chain check runs the SAME code in
 * mock mode as it does live. A mock that confirmed on the status alone would
 * let the most important check in the rail go untested.
 */
import { randomBytes } from "node:crypto";
import type { NearTxResult, NearTxSource } from "./near-rpc.js";
import { nearPayAsset } from "./near-assets.js";

export type OneClickStatus =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "PROCESSING"
  | "SUCCESS"
  | "INCOMPLETE_DEPOSIT"
  | "REFUNDED"
  | "FAILED";

export interface OneClickQuoteRequest {
  originAsset: string;
  destinationAsset: string;
  amount: string; // EXACT_OUTPUT: what the recipient receives, base units
  recipient: string;
  refundTo: string;
  deadline: string;
  slippageTolerance: number;
}

export interface OneClickQuote {
  depositAddress: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountOut: string;
  amountOutFormatted: string;
  deadline: string;
  timeEstimate: number;
}

export interface OneClickStatusResponse {
  status: OneClickStatus;
  quoteResponse: { quoteRequest: { recipient: string }; quote: { amountOut: string } };
  swapDetails: {
    amountOut?: string;
    destinationChainTxHashes: Array<{ hash: string; explorerUrl?: string }>;
    refundedAmount?: string;
  };
}

export type MockPayMode = "success" | "incomplete" | "refund" | "wrong_recipient" | "short";

interface MockSwap {
  request: OneClickQuoteRequest;
  quote: OneClickQuote;
  status: OneClickStatus;
  destinationTxHash?: string;
}

export class MockOneClickServer implements NearTxSource {
  private swaps = new Map<string, MockSwap>();
  private txs = new Map<string, NearTxResult>();
  /** Flip to make every call throw, as an unreachable API or RPC would. */
  down = false;

  constructor(private usdcContract: string) {}

  quote(req: OneClickQuoteRequest): OneClickQuote {
    this.assertUp();
    const asset = nearPayAsset(req.originAsset);
    const price = asset?.mockUsdPrice ?? 1;
    const decimals = asset?.decimals ?? 6;
    // EXACT_OUTPUT: the merchant's USDC is fixed; slippage goes on the input.
    const usd = Number(req.amount) / 1e6;
    const inHuman = (usd / price) * (1 + req.slippageTolerance / 10_000);
    const amountIn = BigInt(Math.ceil(inHuman * 10 ** Math.min(decimals, 15))) *
      10n ** BigInt(Math.max(decimals - 15, 0));
    const quote: OneClickQuote = {
      depositAddress: `mock-dep-${randomBytes(10).toString("hex")}`,
      amountIn: amountIn.toString(),
      amountInFormatted: formatUnits(amountIn, decimals),
      amountOut: req.amount,
      amountOutFormatted: formatUnits(BigInt(req.amount), 6),
      deadline: req.deadline,
      timeEstimate: 30,
    };
    this.swaps.set(quote.depositAddress, { request: req, quote, status: "PENDING_DEPOSIT" });
    return quote;
  }

  status(depositAddress: string): OneClickStatusResponse {
    this.assertUp();
    const s = this.swaps.get(depositAddress);
    if (!s) throw new Error(`unknown deposit address ${depositAddress}`);
    return {
      status: s.status,
      quoteResponse: { quoteRequest: { recipient: s.request.recipient }, quote: { amountOut: s.quote.amountOut } },
      swapDetails: {
        amountOut: s.status === "SUCCESS" ? s.quote.amountOut : undefined,
        destinationChainTxHashes: s.destinationTxHash ? [{ hash: s.destinationTxHash }] : [],
        refundedAmount: s.status === "REFUNDED" ? s.quote.amountIn : undefined,
      },
    };
  }

  /** Accepted and ignored, as the real endpoint is only a hint to speed detection. */
  submitDeposit(_depositAddress: string, _txHash: string): void {
    this.assertUp();
  }

  /**
   * Play the buyer and the solver.
   *
   *   success          — deposit seen, USDC delivered to the quoted recipient
   *   short            — 1Click says SUCCESS but the chain shows less USDC
   *   wrong_recipient  — 1Click says SUCCESS but USDC went to someone else
   *   incomplete       — buyer sent too little; waiting for the rest
   *   refund           — deadline passed, buyer refunded
   */
  pay(depositAddress: string, mode: MockPayMode = "success"): { destinationTxHash?: string } {
    const s = this.swaps.get(depositAddress);
    if (!s) throw new Error(`unknown deposit address ${depositAddress}`);
    if (mode === "incomplete") {
      s.status = "INCOMPLETE_DEPOSIT";
      return {};
    }
    if (mode === "refund") {
      s.status = "REFUNDED";
      return {};
    }
    const to = mode === "wrong_recipient" ? "someone-else.near" : s.request.recipient;
    const amount = mode === "short" ? (BigInt(s.quote.amountOut) / 2n).toString() : s.quote.amountOut;
    const hash = randomBytes(32).toString("base64url").slice(0, 44);
    this.txs.set(hash, {
      receipts_outcome: [
        {
          id: `r-${hash}`,
          outcome: {
            executor_id: this.usdcContract,
            status: { SuccessValue: "" },
            logs: [
              "EVENT_JSON:" +
                JSON.stringify({
                  standard: "nep141",
                  version: "1.0.0",
                  event: "ft_transfer",
                  data: [{ old_owner_id: "intents.near", new_owner_id: to, amount }],
                }),
            ],
          },
        },
      ],
    });
    s.status = "SUCCESS";
    s.destinationTxHash = hash;
    return { destinationTxHash: hash };
  }

  async txStatus(txHash: string): Promise<NearTxResult> {
    this.assertUp();
    const tx = this.txs.get(txHash);
    if (!tx) throw new Error(`unknown NEAR tx ${txHash}`);
    return tx;
  }

  private assertUp(): void {
    if (this.down) throw new Error("mock 1Click/NEAR unreachable");
  }
}

/** Base units → "12.43", trailing zeros trimmed. Exact: no floating point. */
export function formatUnits(units: bigint, decimals: number): string {
  const s = units.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
