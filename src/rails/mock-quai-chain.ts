/**
 * In-process simulator of the parts of Quai/BlipPay the MVP touches: a buyer
 * paying through the RhodiumPay contract, producing a `Paid` log + tx hash.
 * Lets the ENTIRE crypto purchase loop run and be tested with zero chain access.
 * Swap QUAI_ADAPTER_MODE=live to hit a real Quai RPC; the adapter contract is
 * identical.
 */
import { ref } from "../lib/ids.js";

export interface PaidLog {
  txHash: string;
  orderId: string; // bytes32 hex (our order id, hashed/encoded)
  merchant: string;
  token: string; // "0x0" for native QUAI
  amount: string; // token base units
  payer: string;
  blockConfirmed: boolean;
}

export class MockQuaiChain {
  private logsByOrder = new Map<string, PaidLog>();
  private logsByTx = new Map<string, PaidLog>();

  /**
   * Simulate a buyer completing payment in BlipPay. `overrideAmount` lets tests
   * force an amount mismatch. Returns the tx hash the wallet would return.
   */
  simulatePayment(input: {
    orderId: string;
    merchant: string;
    token: string;
    amount: string;
    payer?: string;
    overrideAmount?: string;
  }): PaidLog {
    const log: PaidLog = {
      txHash: ref("0xtx", 16),
      orderId: input.orderId,
      merchant: input.merchant,
      token: input.token,
      amount: input.overrideAmount ?? input.amount,
      payer: input.payer ?? ref("0xbuyer", 10),
      blockConfirmed: true,
    };
    this.logsByOrder.set(input.orderId, log);
    this.logsByTx.set(log.txHash, log);
    return log;
  }

  /** Read a Paid log by tx hash (verifyPayment / confirm-by-txHash path). */
  getLogByTx(txHash: string): PaidLog | undefined {
    return this.logsByTx.get(txHash);
  }

  /** Read a Paid log by orderId (poll fallback / indexer path). */
  getLogByOrder(orderId: string): PaidLog | undefined {
    return this.logsByOrder.get(orderId);
  }
}
