/**
 * In-process simulator of the OnSwitch off-ramp: initiate a crypto→naira order
 * (returns a deposit address + the stablecoin amount to send), and a signed
 * COMPLETED webhook (settlement to the merchant's bank). Lets the whole
 * crypto-in/naira-out loop run with no OnSwitch credentials.
 */
import { createHmac, randomUUID } from "node:crypto";
import { ref } from "../lib/ids.js";
import type { Kobo } from "../lib/money.js";

// Mock FX for display: how many naira per 1 stablecoin unit. [VALIDATE]
const NGN_PER_STABLE = 1600;

interface MockOfframp {
  reference: string;
  orderId: string;
  nairaKobo: Kobo;
  depositAddress: string;
  depositAmount: number; // stablecoin
  asset: string;
  status: "AWAITING_DEPOSIT" | "COMPLETED";
}

export interface SignedWebhook {
  rawBody: string;
  signature: string; // x-switch-signature
}

export class MockOnSwitchServer {
  private byRef = new Map<string, MockOfframp>();
  private byOrder = new Map<string, MockOfframp>();
  constructor(private serviceKey: string, private asset = "base:usdc") {}

  initiate(input: { orderId: string; nairaKobo: Kobo }): MockOfframp {
    const naira = input.nairaKobo / 100;
    const order: MockOfframp = {
      reference: randomUUID(),
      orderId: input.orderId,
      nairaKobo: input.nairaKobo,
      depositAddress: "0x" + ref("", 20).replace(/[^0-9a-f]/gi, "").padEnd(40, "0").slice(0, 40),
      depositAmount: Number((naira / NGN_PER_STABLE).toFixed(6)),
      asset: this.asset,
      status: "AWAITING_DEPOSIT",
    };
    this.byRef.set(order.reference, order);
    this.byOrder.set(input.orderId, order);
    return order;
  }

  getByReference(reference: string): MockOfframp | undefined {
    return this.byRef.get(reference);
  }

  /** Simulate the buyer's deposit + OnSwitch settling naira → signed COMPLETED webhook. */
  complete(reference: string): SignedWebhook {
    const o = this.byRef.get(reference);
    if (!o) throw new Error(`unknown offramp ${reference}`);
    o.status = "COMPLETED";
    const body = {
      success: true,
      message: "settlement completed",
      timestamp: new Date().toISOString(),
      data: {
        status: "COMPLETED",
        type: "OFFRAMP",
        reference: o.reference,
        source: { amount: o.depositAmount, currency: "USD", network: o.asset.split(":")[0] },
        destination: { amount: o.nairaKobo / 100, currency: "NGN", network: "BANK" },
        deposit: { amount: o.depositAmount, address: o.depositAddress, asset: o.asset },
        meta: { orderId: o.orderId },
      },
    };
    return this.sign(JSON.stringify(body));
  }

  private sign(rawBody: string): SignedWebhook {
    return { rawBody, signature: createHmac("sha256", this.serviceKey).update(rawBody).digest("hex") };
  }
}
