/**
 * In-process EVM simulator for the stablecoin rail: records a `payToken` call
 * and produces the `Paid` log a real node would return from eth_getLogs.
 *
 * Exists so the whole crypto loop runs with no RPC, no funded wallet and no
 * testnet faucet — the same reason the Monnify and Paystack mocks exist. Tests
 * that need a chain are tests that do not run.
 */
import { keccak256, toUtf8Bytes } from "./evm-abi.js";

export interface MockPaidLog {
  txHash: string;
  orderIdBytes32: string;
  merchant: string;
  token: string;
  amount: string; // base units, as a decimal string
  payer: string;
}

export class MockEvmChain {
  private paid = new Map<string, MockPaidLog>();
  private nonce = 1;

  /** Simulate a buyer completing payToken() for an order. */
  pay(input: {
    orderId: string;
    merchant: string;
    token: string;
    amount: string;
    payer?: string;
  }): MockPaidLog {
    const log: MockPaidLog = {
      txHash: `0x${(this.nonce++).toString(16).padStart(64, "0")}`,
      orderIdBytes32: keccak256(toUtf8Bytes(input.orderId)),
      merchant: input.merchant.toLowerCase(),
      token: input.token.toLowerCase(),
      amount: input.amount,
      payer: (input.payer ?? "0x00000000000000000000000000000000000000ff").toLowerCase(),
    };
    this.paid.set(log.orderIdBytes32, log);
    return log;
  }

  /** What eth_getLogs would return for this order, or undefined. */
  findByOrderIdHash(orderIdBytes32: string): MockPaidLog | undefined {
    return this.paid.get(orderIdBytes32);
  }

  byTxHash(txHash: string): MockPaidLog | undefined {
    for (const l of this.paid.values()) if (l.txHash === txHash) return l;
    return undefined;
  }
}
