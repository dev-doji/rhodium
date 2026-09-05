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
    ngnPerUsd: 1600,
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
