import { describe, it, expect } from "vitest";
import { makeApp, seedMerchant, seedProduct } from "./helpers/harness.js";
import { OnSwitchRail } from "../src/rails/onswitch-rail.js";
import { AppError } from "../src/lib/errors.js";

function offrampOrder(app: ReturnType<typeof makeApp>, merchantId: string, productId: string) {
  return app.commerce.createOrder({
    merchantId, buyerRef: "+2348090007777",
    lines: [{ productId, qty: 1 }], rail: "crypto",
  });
}

describe("OnSwitch off-ramp — buyer pays stablecoin, merchant paid naira", () => {
  it("issues a deposit address and settles the sale into the naira ledger", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app); // has bank account
    const product = await seedProduct(app, merchant.id, 500_000);
    const order = await offrampOrder(app, merchant.id, product.id);

    const inst = await app.payments.requestPayment(order.id, "onswitch");
    expect(inst.instructionType).toBe("crypto");
    expect(inst.settlesToNaira).toBe(true);
    expect(inst.depositAddress).toMatch(/^0x[0-9a-f]{40}$/i);
    expect(Number(inst.cryptoAmount)).toBeGreaterThan(0);

    const rail = app.rails.get("onswitch") as OnSwitchRail;
    const signed = rail.mock!.complete(inst.providerRef);
    await app.payments.handleRailWebhook("onswitch", {
      headers: { "x-switch-signature": signed.signature },
      rawBody: signed.rawBody,
    });

    expect((await app.repos.orders.byId(order.id))!.status).toBe("paid");
    const entries = await app.ledger.entries(merchant.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.amount).toBe(500_000); // naira kobo — merchant credited in naira
  });

  it("refuses the off-ramp when the merchant has no bank account", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app, {
      settlementBankCode: undefined, settlementAccountNumber: undefined,
    });
    const product = await seedProduct(app, merchant.id, 500_000);
    const order = await offrampOrder(app, merchant.id, product.id);
    await expect(app.payments.requestPayment(order.id, "onswitch")).rejects.toBeInstanceOf(AppError);
  });

  it("rejects a forged webhook signature and is idempotent on replay", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    const product = await seedProduct(app, merchant.id, 500_000);
    const order = await offrampOrder(app, merchant.id, product.id);
    const inst = await app.payments.requestPayment(order.id, "onswitch");
    const rail = app.rails.get("onswitch") as OnSwitchRail;
    const signed = rail.mock!.complete(inst.providerRef);

    await expect(
      app.payments.handleRailWebhook("onswitch", {
        headers: { "x-switch-signature": "bad" }, rawBody: signed.rawBody,
      }),
    ).rejects.toBeInstanceOf(AppError);

    await app.payments.handleRailWebhook("onswitch", { headers: { "x-switch-signature": signed.signature }, rawBody: signed.rawBody });
    await app.payments.handleRailWebhook("onswitch", { headers: { "x-switch-signature": signed.signature }, rawBody: signed.rawBody });
    expect(await app.ledger.entries(merchant.id)).toHaveLength(1);
  });
});

describe("when OnSwitch refuses the request", () => {
  /**
   * A live rail pointed at a stub, so the error path is exercised without a
   * network. Only `api()` is under test here — the thing that decides what a
   * failure tells whoever has to fix it.
   */
  function liveRailAgainst(status: number, body: string) {
    const rail = new OnSwitchRail({
      mode: "live",
      serviceKey: "test-key",
      baseUrl: "https://onswitch.invalid",
      asset: "arbitrum:usdc",
      callbackUrl: "https://example.test/webhooks/rails/onswitch",
    });
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(body, { status, headers: { "content-type": "application/json" } })) as typeof fetch;
    return {
      rail,
      restore: () => {
        globalThis.fetch = original;
      },
    };
  }

  async function messageFrom(status: number, body: string): Promise<string> {
    const { rail, restore } = liveRailAgainst(status, body);
    try {
      const app = makeApp();
      const merchant = await seedMerchant(app);
      const product = await seedProduct(app, merchant.id, 10_000);
      const order = await offrampOrder(app, merchant.id, product.id);
      await rail.createPaymentInstruction(order, merchant);
      throw new Error("expected the rail to throw");
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      return e.message;
    } finally {
      restore();
    }
  }

  it("repeats what OnSwitch actually said, not just the status", async () => {
    // A ₦100 order is about six cents. Whatever the real reason, the provider
    // states it plainly in the 422 — and "onswitch api 422" threw that away,
    // leaving a 502 in the browser and nothing to act on.
    const msg = await messageFrom(422, JSON.stringify({ message: "amount is below the minimum of 5000 NGN" }));
    expect(msg).toContain("below the minimum");
    expect(msg).toContain("422");
  });

  it("names the field when the error is a validation map", async () => {
    const msg = await messageFrom(
      422,
      JSON.stringify({ errors: { amount: ["must be at least 5000"], "beneficiary.bank_code": ["is invalid"] } }),
    );
    expect(msg).toContain("amount: must be at least 5000");
    expect(msg).toContain("beneficiary.bank_code: is invalid");
  });

  it("handles a plain array of errors", async () => {
    const msg = await messageFrom(422, JSON.stringify({ errors: ["asset not supported"] }));
    expect(msg).toContain("asset not supported");
  });

  it("falls back to the raw body when the response is not JSON", async () => {
    const msg = await messageFrom(502, "<html>Bad Gateway</html>");
    expect(msg).toContain("Bad Gateway");
  });

  it("still says which call failed", async () => {
    const msg = await messageFrom(422, JSON.stringify({ message: "nope" }));
    expect(msg).toContain("/offramp/initiate");
  });
});

describe("which deposits a browser wallet can pay", () => {
  async function instructionFor(asset: string, mode: "mock" | "live" = "mock") {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    const product = await seedProduct(app, merchant.id, 420_000);
    const order = await offrampOrder(app, merchant.id, product.id);
    const rail = new OnSwitchRail({
      mode,
      serviceKey: "test-key",
      baseUrl: "https://onswitch.invalid",
      asset,
      callbackUrl: "https://example.test/webhooks/rails/onswitch",
    });
    if (mode === "mock") return rail.createPaymentInstruction(order, merchant);

    // Live path against a stubbed provider, so the wallet metadata is exercised
    // without a network call.
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            reference: "ref_live",
            deposit: { address: "0x000000000000000000000000000000000000dEaD", amount: 4.0625, asset },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    try {
      return await rail.createPaymentInstruction(order, merchant);
    } finally {
      globalThis.fetch = original;
    }
  }

  it("offers NO wallet payment in mock mode, whatever the asset", async () => {
    // A mock deposit address is invented and belongs to nobody. Pairing it
    // with chain 42161 and Circle's real USDC contract would have put a button
    // in front of a buyer that sends REAL money into a void — a mistake this
    // code made for exactly one commit.
    const inst = await instructionFor("arbitrum:usdc");
    expect(inst.walletChainId).toBeUndefined();
    expect(inst.tokenAddress).toBeUndefined();
    expect(inst.depositAddress).toBeTruthy();
  });

  it("carries the chain and token for an EVM asset", async () => {
    // The checkout needs both to build a transfer. Without them it can only
    // offer "copy the address", which is what a buyer was left with.
    const inst = await instructionFor("arbitrum:usdc", "live");
    expect(inst.walletChainId).toBe(42161);
    // Circle's NATIVE USDC on Arbitrum One, verified on chain (symbol USDC,
    // decimals 6) rather than copied from a list. The bridged USDC.e at
    // 0xFF970A61… also reports symbol USDC and is a different asset.
    expect(inst.tokenAddress?.toLowerCase()).toBe("0xaf88d065e77c8cc2239327c5edb3a432268e5831");
    expect(inst.tokenDecimals).toBe(6);
  });

  it("carries nothing for an asset no EVM wallet can send", async () => {
    // Tron is the production default today. MetaMask cannot send TRC-20 at
    // all, so offering a wallet button there would be a broken promise.
    const inst = await instructionFor("tron:usdt", "live");
    expect(inst.walletChainId).toBeUndefined();
    expect(inst.tokenAddress).toBeUndefined();
    expect(inst.depositAddress).toBeTruthy(); // copy-the-address still works
  });

  it("still names the asset and network whatever the chain", async () => {
    const tron = await instructionFor("tron:usdt");
    expect(tron.tokenSymbol).toBe("USDT");
    expect(tron.network).toBe("tron");
    const arb = await instructionFor("arbitrum:usdc");
    expect(arb.tokenSymbol).toBe("USDC");
    expect(arb.network).toBe("arbitrum");
  });
});
