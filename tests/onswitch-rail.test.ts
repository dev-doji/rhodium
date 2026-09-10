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

  it("offers no wallet payment for OnSwitch's sandbox placeholder address", async () => {
    // The sandbox returns the literal 0x000000000000000000000000000000000sandbox
    // — 42 characters, deliberately address-shaped, not hex — and it runs with
    // mode "live" because the environment is chosen by the API key, not the
    // host. A mode check alone therefore offered a wallet payment to a string
    // no wallet can parse, and the buyer got a failure with no explanation.
    const app = makeApp();
    const merchant = await seedMerchant(app);
    const product = await seedProduct(app, merchant.id, 420_000);
    const order = await offrampOrder(app, merchant.id, product.id);
    const rail = new OnSwitchRail({
      mode: "live",
      serviceKey: "test-key",
      baseUrl: "https://onswitch.invalid",
      asset: "arbitrum:usdc",
      callbackUrl: "https://example.test/webhooks/rails/onswitch",
    });
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            reference: "ref_sandbox",
            deposit: {
              address: "0x000000000000000000000000000000000sandbox",
              amount: 3.0625,
              asset: "arbitrum:usdc",
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    try {
      const inst = await rail.createPaymentInstruction(order, merchant);
      expect(inst.depositAddress).toBe("0x000000000000000000000000000000000sandbox");
      expect(inst.walletChainId).toBeUndefined();
      expect(inst.tokenAddress).toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
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

describe("names the provider will accept", () => {
  it("strips what OnSwitch refuses, keeping the shop recognisable", async () => {
    // Observed live from their validator: "Name can only contain alphanumeric
    // characters, must contain at least one letter, should not contain crypto
    // related terms." Merchants call shops "Tee's Kitchen" and "A&B Stores";
    // sent raw those are refused and the buyer sees a 422 about a name they
    // cannot change, for a shop that is entirely legitimate.
    const { bankSafeName } = await import("../src/rails/onswitch-rail.js");
    expect(bankSafeName("Tee's Kitchen")).toBe("Tees Kitchen");
    expect(bankSafeName("A&B Stores")).toBe("AB Stores");
    expect(bankSafeName("Mama-Put Foods")).toBe("MamaPut Foods");
    expect(bankSafeName("Shop (Ikeja)")).toBe("Shop Ikeja");
    // Already clean names are left alone.
    expect(bankSafeName("Tees kitchen")).toBe("Tees kitchen");
  });

  it("never sends a name with no letters in it", async () => {
    // "123" would be refused with a message about letters that names nothing
    // the merchant could act on.
    const { bankSafeName } = await import("../src/rails/onswitch-rail.js");
    expect(bankSafeName("123")).toBe("Merchant");
    expect(bankSafeName("")).toBe("Merchant");
    expect(bankSafeName("!!!")).toBe("Merchant");
  });

  it("stays within the field's length", async () => {
    const { bankSafeName } = await import("../src/rails/onswitch-rail.js");
    expect(bankSafeName("A".repeat(200)).length).toBe(60);
  });
});

describe("polling the provider for a status", () => {
  /** Captures the URL the rail asks for, and answers with a given status. */
  async function pollWith(status: string | null) {
    const rail = new OnSwitchRail({
      mode: "live",
      serviceKey: "test-key",
      baseUrl: "https://onswitch.invalid",
      asset: "arbitrum:usdc",
      callbackUrl: "https://example.test/webhooks/rails/onswitch",
    });
    let asked = "";
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      asked = String(url);
      if (status === null) {
        return new Response(JSON.stringify({ success: false, message: "Payment not found" }), { status: 404 });
      }
      return new Response(JSON.stringify({ success: true, data: { status, reference: "ref" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    try {
      const result = await rail.verifyPayment("ref_123");
      return { asked, result };
    } finally {
      globalThis.fetch = original;
    }
  }

  it("asks the endpoint that exists", async () => {
    // It asked GET /offramp/{ref}, which OnSwitch answers 404 "Resource does
    // not exist" — verified against their live API. The catch turned that into
    // "pending", so the poll fallback never once worked: "I've sent it — check
    // now" could only say "not showing yet", and reconciliation could never
    // confirm an off-ramp the webhook had missed.
    const { asked } = await pollWith("AWAITING_DEPOSIT");
    expect(asked).toContain("/payment/status?reference=ref_123");
    expect(asked).not.toContain("/offramp/ref_123");
  });

  it("confirms only on COMPLETED", async () => {
    expect((await pollWith("COMPLETED")).result.status).toBe("confirmed");
    for (const waiting of ["AWAITING_DEPOSIT", "PROCESSING", "SCHEDULED"]) {
      expect((await pollWith(waiting)).result.status, waiting).toBe("pending");
    }
  });

  it("does not report a dead payment as still coming", async () => {
    // Telling a buyer to keep waiting for a payment that was reversed or
    // blocked is worse than telling them nothing.
    for (const dead of ["FAILED", "REVERSED", "BLOCKED"]) {
      expect((await pollWith(dead)).result.status, dead).toBe("failed");
    }
  });

  it("treats an unknown reference as pending, not failed", async () => {
    // A 404 may mean "not yet visible" as easily as "never existed", and
    // marking a live order failed on that would be worse than waiting.
    expect((await pollWith(null)).result.status).toBe("pending");
  });
});
