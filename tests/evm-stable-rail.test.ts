import { describe, it, expect } from "vitest";
import { EvmStableRail } from "../src/rails/evm-stable-rail.js";
import { orderIdToBytes32 } from "../src/rails/evm-abi.js";
import { AppError } from "../src/lib/errors.js";
import type { Merchant, Order } from "../src/domain/types.js";

const USDC_SEPOLIA = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
const CONTRACT = "0x00000000000000000000000000000000000000aa";
const MERCHANT_WALLET = "0x00000000000000000000000000000000000000bb";

function rail(over: Partial<ConstructorParameters<typeof EvmStableRail>[0]> = {}) {
  return new EvmStableRail({
    mode: "mock",
    chainId: 421614,
    chainName: "Arbitrum Sepolia",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    explorerUrl: "https://sepolia.arbiscan.io",
    contractAddress: CONTRACT,
    tokenAddress: USDC_SEPOLIA,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    ngnPerUsd: () => 1600,
    publicBaseUrl: "https://pay.userhodium.xyz",
    ...over,
  });
}

const merchant = {
  id: "mch_evm", phone: "+2348030000001", businessName: "Circuit City",
  status: "active", kycState: "verified", cryptoEnabled: true,
  quaiAddress: MERCHANT_WALLET, createdAt: new Date(),
} as Merchant;

const order = {
  id: "ord_evm_1", merchantId: "mch_evm", buyerRef: "+2349032621846",
  items: [], amount: 1_600_00, // ₦1,600 => exactly 1 USDC at 1600/USD
  status: "awaiting_payment", rail: "crypto", createdAt: new Date(),
} as unknown as Order;

describe("EVM stablecoin rail", () => {
  it("prices naira into SIX-decimal base units, not eighteen", async () => {
    const inst = await rail().createPaymentInstruction(order, merchant);
    // ₦1,600 ÷ ₦1,600/USD = 1 USDC = 1_000_000 base units.
    // Assuming 18 decimals would ask for 1e18 — a million times too much, and
    // the wallet would show a plausible number while doing it.
    expect(inst.cryptoAmount).toBe("1000000");
    expect(inst.tokenSymbol).toBe("USDC");
    expect(inst.tokenAddress).toBe(USDC_SEPOLIA);
    expect(inst.method).toBe("payToken");
    expect(inst.chainId).toBe("421614");
  });

  it("states the display amount as a buyer reads it, not base units", async () => {
    const inst = await rail().createPaymentInstruction(order, merchant);
    // The contract call takes base units; a buyer does not. Rendering the call
    // argument put "1000000 USDC" on screen for a ₦1,600 order.
    expect(inst.cryptoAmount).toBe("1000000");
    expect(Number(inst.cryptoAmountDisplay)).toBe(1);

    const small = { ...order, amount: 100_00 } as Order; // ₦100
    const inst2 = await rail().createPaymentInstruction(small, merchant);
    expect(inst2.cryptoAmount).toBe("62500");
    expect(Number(inst2.cryptoAmountDisplay)).toBeCloseTo(0.0625, 6);
  });

  it("settles to the MERCHANT's wallet, never ours", () => {
    const t = rail().settlementTarget(merchant);
    expect(t.owner).toBe("merchant");
    expect(t.walletAddress).toBe(MERCHANT_WALLET);
  });

  it("refuses to quote for a merchant with no wallet", async () => {
    const noWallet = { ...merchant, quaiAddress: undefined } as Merchant;
    await expect(rail().createPaymentInstruction(order, noWallet)).rejects.toBeInstanceOf(AppError);
  });

  it("confirms only when a Paid log carries THIS order's id hash", async () => {
    const r = rail();
    const inst = await r.createPaymentInstruction(order, merchant);
    const log = r.mock!.pay({
      orderId: order.id, merchant: MERCHANT_WALLET,
      token: USDC_SEPOLIA, amount: inst.cryptoAmount!,
    });

    const event = await r.handleWebhook({
      headers: {}, rawBody: JSON.stringify({ orderId: order.id, txHash: log.txHash }),
    });
    expect(event.status).toBe("confirmed");
    expect(event.amount).toBe(order.amount);
    expect(event.rawEventId).toBe(log.txHash);
  });

  it("ignores a real transaction that paid a DIFFERENT order", async () => {
    const r = rail();
    await r.createPaymentInstruction(order, merchant);
    const other = r.mock!.pay({
      orderId: "ord_someone_else", merchant: MERCHANT_WALLET,
      token: USDC_SEPOLIA, amount: "1000000",
    });
    // A buyer must not be able to settle their order by quoting a hash they
    // found on the explorer.
    const event = await r.handleWebhook({
      headers: {}, rawBody: JSON.stringify({ orderId: order.id, txHash: other.txHash }),
    });
    expect(event.status).toBe("ignored");
  });

  it("reports who received the funds, so the recipient can be checked", async () => {
    const r = rail();
    const inst = await r.createPaymentInstruction(order, merchant);
    const log = r.mock!.pay({
      orderId: order.id, merchant: MERCHANT_WALLET,
      token: USDC_SEPOLIA, amount: inst.cryptoAmount!,
    });
    const event = await r.handleWebhook({
      headers: {}, rawBody: JSON.stringify({ orderId: order.id, txHash: log.txHash }),
    });
    // A Paid log names its own recipient. The rail cannot know which address
    // was quoted, so it surfaces what it saw and the orchestrator decides.
    expect(event.recipient?.toLowerCase()).toBe(MERCHANT_WALLET.toLowerCase());
    expect((await r.verifyPayment(order.id)).recipient?.toLowerCase()).toBe(
      MERCHANT_WALLET.toLowerCase(),
    );
  });

  it("ignores an unknown transaction hash", async () => {
    const event = await rail().handleWebhook({
      headers: {}, rawBody: JSON.stringify({ orderId: order.id, txHash: "0xdeadbeef" }),
    });
    expect(event.status).toBe("ignored");
  });

  it("keys idempotency on the transaction, so a replay credits once", async () => {
    const r = rail();
    const inst = await r.createPaymentInstruction(order, merchant);
    const log = r.mock!.pay({
      orderId: order.id, merchant: MERCHANT_WALLET,
      token: USDC_SEPOLIA, amount: inst.cryptoAmount!,
    });
    const body = JSON.stringify({ orderId: order.id, txHash: log.txHash });
    const a = await r.handleWebhook({ headers: {}, rawBody: body });
    const b = await r.handleWebhook({ headers: {}, rawBody: body });
    expect(b.idempotencyKey).toBe(a.idempotencyKey);
  });

  it("polls the chain for a missed confirmation", async () => {
    const r = rail();
    const inst = await r.createPaymentInstruction(order, merchant);
    expect((await r.verifyPayment(order.id)).status).toBe("pending");

    r.mock!.pay({
      orderId: order.id, merchant: MERCHANT_WALLET,
      token: USDC_SEPOLIA, amount: inst.cryptoAmount!,
    });
    const after = await r.verifyPayment(order.id);
    expect(after.status).toBe("confirmed");
    expect(after.amount).toBe(order.amount);
  });

  it("is chain-agnostic: same rail, different chain, from config alone", async () => {
    const base = rail({
      chainId: 8453, chainName: "Base",
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      explorerUrl: "https://basescan.org",
    });
    const inst = await base.createPaymentInstruction(order, merchant);
    expect(inst.chainId).toBe("8453");
    expect(inst.network).toBe("Base");
    expect(inst.cryptoAmount).toBe("1000000"); // pricing is chain-independent
  });

  it("prices at the CURRENT rate, not the one captured at boot", async () => {
    let rate = 1600;
    const r = rail({ ngnPerUsd: () => rate });
    expect((await r.createPaymentInstruction(order, merchant)).cryptoAmount).toBe("1000000");

    // The naira price is unchanged; the market moved. A buyer quoted ₦1,600 at
    // 1320/USD must be asked for 1.21 USDC, not the 1.00 the boot-time constant
    // would have charged — that gap is the merchant's, and it is silent.
    rate = 1320;
    expect((await r.createPaymentInstruction(order, merchant)).cryptoAmount).toBe("1212121");
  });

  it("polls over bounded hex block ranges, never earliest→latest", async () => {
    const calls: Record<string, unknown>[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      const req = JSON.parse(init.body) as { method: string; params: unknown[] };
      if (req.method === "eth_blockNumber") {
        return { ok: true, json: async () => ({ result: "0x3ba0000" }) };
      }
      calls.push(req.params[0] as Record<string, unknown>);
      return { ok: true, json: async () => ({ result: [] }) };
    }) as unknown as typeof fetch;

    try {
      const live = rail({ mode: "live", logLookbackBlocks: 12_000, logChunkBlocks: 5_000 });
      await live.verifyPayment(order.id);
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(calls.length).toBeGreaterThan(1); // the window needs more than one request
    for (const c of calls) {
      // Arbitrum rejects a non-hex fromBlock outright and Arc caps the span, so
      // an unbounded earliest→latest scan silently verified nothing in prod.
      expect(c.fromBlock).toMatch(/^0x[0-9a-f]+$/);
      expect(c.toBlock).toMatch(/^0x[0-9a-f]+$/);
      const span = BigInt(c.toBlock as string) - BigInt(c.fromBlock as string);
      expect(span).toBeLessThanOrEqual(5_000n);
    }
  });

  it("reports pending, not confirmed, when the chain cannot be reached", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    try {
      const live = rail({ mode: "live" });
      // An RPC that refuses every query must never read as "nobody paid this".
      await expect(live.verifyPayment(order.id)).resolves.toMatchObject({ status: "pending" });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("derives the order id hash the contract is called with", () => {
    expect(orderIdToBytes32("ord_evm_1")).toMatch(/^0x[0-9a-f]{64}$/);
    expect(orderIdToBytes32("a")).not.toBe(orderIdToBytes32("b"));
  });
});

describe("EVM stablecoin through the whole payment loop", () => {
  it("settles into the naira ledger, once", async () => {
    process.env.FEATURE_EVM_STABLE_ENABLED = "true";
    process.env.EVM_ADAPTER_MODE = "mock";
    process.env.EVM_CONTRACT_ADDRESS = CONTRACT;
    const { makeApp, seedMerchant, seedProduct } = await import("./helpers/harness.js");
    const app = makeApp();
    try {
      const m = await seedMerchant(app, { quaiAddress: MERCHANT_WALLET, cryptoEnabled: true, cryptoSettlement: "usdc" });
      const p = await seedProduct(app, m.id, 1_600_00);
      const o = await app.commerce.createOrder({
        merchantId: m.id, buyerRef: "+2349032621846",
        lines: [{ productId: p.id, qty: 1 }], rail: "crypto",
      });

      const inst = await app.payments.requestPayment(o.id);
      expect(inst.railId).toBe("evm_stable");
      expect(inst.cryptoAmount).toBe("1000000");

      const evm = app.rails.get("evm_stable") as { mock?: { pay: (i: Record<string, string>) => { txHash: string } } };
      const log = evm.mock!.pay({
        orderId: o.id, merchant: MERCHANT_WALLET,
        token: USDC_SEPOLIA, amount: inst.cryptoAmount!,
      });

      const body = JSON.stringify({ orderId: o.id, txHash: log.txHash });
      await app.payments.handleRailWebhook("evm_stable", { headers: {}, rawBody: body });

      expect((await app.repos.orders.byId(o.id))!.status).toBe("paid");
      // A stablecoin sale lands in the SAME naira ledger as a bank transfer —
      // that single ledger is the whole point of the rail abstraction.
      expect(await app.ledger.balance(m.id)).toBe(1_600_00);

      // Same transaction submitted twice must not credit twice.
      await app.payments.handleRailWebhook("evm_stable", { headers: {}, rawBody: body });
      expect(await app.ledger.entries(m.id)).toHaveLength(1);
    } finally {
      delete process.env.FEATURE_EVM_STABLE_ENABLED;
      delete process.env.EVM_CONTRACT_ADDRESS;
    }
  });

  it("refuses a payment that went to the payer's own wallet", async () => {
    process.env.FEATURE_EVM_STABLE_ENABLED = "true";
    process.env.EVM_ADAPTER_MODE = "mock";
    process.env.EVM_CONTRACT_ADDRESS = CONTRACT;
    const { makeApp, seedMerchant, seedProduct } = await import("./helpers/harness.js");
    const app = makeApp();
    try {
      const m = await seedMerchant(app, { quaiAddress: MERCHANT_WALLET, cryptoEnabled: true, cryptoSettlement: "usdc" });
      const p = await seedProduct(app, m.id, 1_600_00);
      const o = await app.commerce.createOrder({
        merchantId: m.id, buyerRef: "+2349032621846",
        lines: [{ productId: p.id, qty: 1 }], rail: "crypto",
      });
      const inst = await app.payments.requestPayment(o.id);

      // RhodiumPay.payToken lets the caller name the recipient, so the buyer
      // can route their own USDC back to themselves while quoting this order.
      // The transaction is real and the order id matches — only the recipient
      // is wrong, and that is the whole of the fraud.
      const ATTACKER = "0x00000000000000000000000000000000000000cc";
      const evm = app.rails.get("evm_stable") as { mock?: { pay: (i: Record<string, string>) => { txHash: string } } };
      const log = evm.mock!.pay({
        orderId: o.id, merchant: ATTACKER,
        token: USDC_SEPOLIA, amount: inst.cryptoAmount!,
      });

      await expect(
        app.payments.handleRailWebhook("evm_stable", {
          headers: {},
          rawBody: JSON.stringify({ orderId: o.id, txHash: log.txHash }),
        }),
      ).rejects.toThrow(/recipient/i);

      expect((await app.repos.orders.byId(o.id))!.status).toBe("awaiting_payment");
      expect(await app.ledger.balance(m.id)).toBe(0);
    } finally {
      delete process.env.FEATURE_EVM_STABLE_ENABLED;
      delete process.env.EVM_CONTRACT_ADDRESS;
    }
  });

  it("crypto + fiat sales land in the SAME ledger and traction snapshot", async () => {
    // Ported from the retired Quai rail's suite. The single naira ledger
    // across both rails is the whole point of the rail abstraction, and it is
    // the one thing the per-rail tests cannot prove on their own.
    process.env.FEATURE_EVM_STABLE_ENABLED = "true";
    process.env.EVM_ADAPTER_MODE = "mock";
    process.env.EVM_CONTRACT_ADDRESS = CONTRACT;
    const { makeApp, seedMerchant, seedProduct } = await import("./helpers/harness.js");
    const app = makeApp();
    try {
      const m = await seedMerchant(app, { quaiAddress: MERCHANT_WALLET, cryptoEnabled: true, cryptoSettlement: "usdc" });
      const p = await seedProduct(app, m.id, 500_000);

      // one on-chain sale
      const cryptoOrd = await app.commerce.createOrder({
        merchantId: m.id, buyerRef: "+2348090005555",
        lines: [{ productId: p.id, qty: 1 }], rail: "crypto",
      });
      const cInst = await app.payments.requestPayment(cryptoOrd.id);
      const evm = app.rails.get("evm_stable") as {
        mock?: { pay: (i: Record<string, string>) => { txHash: string } };
      };
      const log = evm.mock!.pay({
        orderId: cryptoOrd.id, merchant: MERCHANT_WALLET,
        token: USDC_SEPOLIA, amount: cInst.cryptoAmount!,
      });
      await app.payments.handleRailWebhook("evm_stable", {
        headers: {},
        rawBody: JSON.stringify({ orderId: cryptoOrd.id, txHash: log.txHash }),
      });

      // one bank sale, on whichever fiat rail is configured
      const fiatOrder = await app.commerce.createOrder({
        merchantId: m.id, buyerRef: "+2348090006666",
        lines: [{ productId: p.id, qty: 1 }],
      });
      const fInst = await app.payments.requestPayment(fiatOrder.id);
      const signed = app.fiat.mock!.simulateTransfer(fInst.providerRef);
      await app.payments.handleRailWebhook(app.fiat.id, {
        headers: { [app.fiat.webhookSignatureHeader!]: signed.signature },
        rawBody: signed.rawBody,
      });

      expect(await app.ledger.entries(m.id)).toHaveLength(2);
      const t = await app.traction.snapshot();
      expect(t.salesCount).toBe(2);
      expect(t.railSplit.crypto).toBe(1);
      expect(t.railSplit.fiat).toBe(1);
      expect(t.gmvKobo).toBe(1_000_000);
      expect(t.uniqueBuyers).toBe(2);
    } finally {
      delete process.env.FEATURE_EVM_STABLE_ENABLED;
      delete process.env.EVM_CONTRACT_ADDRESS;
    }
  });
});
