import { AppError } from "../lib/errors.js";

/**
 * The slice of a NEAR transaction result this codebase reads: every receipt's
 * logs, who executed it, and whether it succeeded. Shape per NEAR's `tx` RPC.
 */
export interface NearTxResult {
  receipts_outcome: Array<{
    id: string;
    outcome: {
      logs: string[];
      executor_id: string;
      status: { SuccessValue?: string; SuccessReceiptId?: string; Failure?: unknown };
    };
  }>;
}

/** Anything that can fetch a finalised NEAR transaction — the live RPC, or the mock. */
export interface NearTxSource {
  txStatus(txHash: string, senderAccountId: string): Promise<NearTxResult>;
}

/**
 * A tiny NEAR JSON-RPC client. Only what the rails need, so there is no SDK
 * between us and the response we are trusting with a merchant's money.
 */
export class NearRpc implements NearTxSource {
  constructor(private url: string) {}

  /**
   * A transaction, waited on until FINAL.
   *
   * Final, not merely included: a NEAR block can still be reorganised before
   * finality, and a sale credited on a transfer that then vanishes is a sale
   * the merchant shipped for free.
   */
  txStatus(txHash: string, senderAccountId: string): Promise<NearTxResult> {
    return this.call<NearTxResult>("tx", {
      tx_hash: txHash,
      sender_account_id: senderAccountId,
      wait_until: "FINAL",
    });
  }

  /** Whether an account exists on chain. Refuses to guess on an RPC error. */
  async accountExists(accountId: string): Promise<boolean> {
    try {
      await this.call("query", { request_type: "view_account", finality: "final", account_id: accountId });
      return true;
    } catch (err) {
      if (/UNKNOWN_ACCOUNT/.test((err as Error).message)) return false;
      throw err;
    }
  }

  private async call<T>(method: string, params: unknown): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "rhodium", method, params }),
    });
    if (!res.ok) throw new AppError(`near rpc ${res.status}`, "provider_error", 502);
    const body = (await res.json()) as { result?: T; error?: { message?: string; cause?: { name?: string } } };
    if (body.error) {
      throw new AppError(
        `near rpc: ${body.error.cause?.name ?? body.error.message ?? "error"}`,
        "provider_error",
        502,
      );
    }
    return body.result as T;
  }
}

/**
 * Sum the NEP-141 `ft_transfer` amounts a token contract logged, per receiver.
 *
 * Reads NEP-297 event lines —
 *   EVENT_JSON:{"standard":"nep141","event":"ft_transfer","data":[{old_owner_id,new_owner_id,amount}]}
 * — and only from receipts EXECUTED BY the token contract that SUCCEEDED.
 * Anyone can write that string into a log from their own contract; only the
 * token contract writing it means a balance actually moved. A failed receipt's
 * state change is rolled back, so its logs prove nothing either.
 */
export function ftTransfersTo(tx: NearTxResult, tokenContract: string): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const r of tx.receipts_outcome ?? []) {
    if (r.outcome.executor_id !== tokenContract) continue;
    if (r.outcome.status?.Failure !== undefined) continue;
    for (const line of r.outcome.logs ?? []) {
      if (!line.startsWith("EVENT_JSON:")) continue;
      let ev: { standard?: string; event?: string; data?: Array<{ new_owner_id?: string; amount?: string }> };
      try {
        ev = JSON.parse(line.slice("EVENT_JSON:".length));
      } catch {
        continue;
      }
      if (ev.standard !== "nep141" || ev.event !== "ft_transfer") continue;
      for (const d of ev.data ?? []) {
        if (!d.new_owner_id || !/^\d+$/.test(d.amount ?? "")) continue;
        totals.set(d.new_owner_id, (totals.get(d.new_owner_id) ?? 0n) + BigInt(d.amount!));
      }
    }
  }
  return totals;
}
