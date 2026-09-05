import { describe, it, expect } from "vitest";
import { makeApp, seedMerchant, seedProduct } from "./helpers/harness.js";
import { QuaiRail } from "../src/rails/quai-rail.js";
import { koboToUsdtUnits } from "../src/lib/fx.js";
import { AppError, ValidationError } from "../src/lib/errors.js";

function cryptoRail(app: ReturnType<typeof makeApp>): QuaiRail {
  return app.rails.crypto() as QuaiRail;
}

async function cryptoOrder(app: ReturnType<typeof makeApp>, merchantId: string, productId: string) {
  const order = await app.commerce.createOrder({
    merchantId,
    buyerRef: "+2348090005555",
    lines: [{ productId, qty: 1 }],
    rail: "crypto",
  });
  const instruction = await app.payments.requestPayment(order.id);
  return { order, instruction };
}

function simulatePay(app: ReturnType<typeof makeApp>, orderId: string, kobo: number, override?: number) {
  const rail = cryptoRail(app);
  const paid = rail.chain!.simulatePayment({
    orderId,
    merchant: "0xMerchantWallet",
    token: "0xUSDTMock",
    amount: koboToUsdtUnits(kobo),
    overrideAmount: override != null ? koboToUsdtUnits(override) : undefined,
  });
  return app.payments.handleRailWebhook("quai", {
    headers: {},
    rawBody: JSON.stringify({ txHash: paid.txHash }),
  });
}

describe("Quai/BlipPay crypto rail — WhatsApp merchant accepts crypto, books in naira", () => {
  it("issues a BlipPay checkout instruction with an on-chain match key", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app, { quaiAddress: "0xMerchantWallet" });
    const product = await seedProduct(app, merchant.id, 500_000);
    const { order, instruction } = await cryptoOrder(app, merchant.id, product.id);

    expect(instruction.instructionType).toBe("crypto");
    expect(instruction.providerRef).toBe(order.id); // orderId = match key
    expect(instruction.tokenSymbol).toBe("USDT");
    expect(instruction.cryptoAmount).toBe(koboToUsdtUnits(500_000)); // ₦5000 → 3.125 USDT
    expect(instruction.checkoutUrl).toContain(`/checkout/${order.id}`);
    // Universal link rather than the blip:// scheme: a custom scheme fails
    // silently when the app is absent, so the buyer taps and nothing happens.
    expect(instruction.deepLink).toContain("https://blippay.me/browser");
    expect(instruction.deepLink).toContain(encodeURIComponent(order.id));
  });

  it("refuses to issue crypto payment when the merchant has no wallet (no-custody)", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app, { quaiAddress: undefined });
    const product = await seedProduct(app, merchant.id, 500_000);
    const order = await app.commerce.createOrder({
      merchantId: merchant.id,
      buyerRef: "+2348090005555",
      lines: [{ productId: product.id, qty: 1 }],
      rail: "crypto",
    });
    await expect(app.payments.requestPayment(order.id)).rejects.toBeInstanceOf(AppError);
  });

  it("confirms a BlipPay payment and records ONE naira ledger entry", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app, { quaiAddress: "0xMerchantWallet" });
    const product = await seedProduct(app, merchant.id, 500_000);
    const { order } = await cryptoOrder(app, merchant.id, product.id);

    await simulatePay(app, order.id, 500_000);

    const finalOrder = await app.repos.orders.byId(order.id);
    const entries = await app.ledger.entries(merchant.id);
    expect(finalOrder!.status).toBe("paid");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.amount).toBe(500_000); // naira kobo, not crypto units
    // Who was told + the naira amount, rather than the exact wording.
    const sent = app.channel.sent;
    const toMerchant = sent.find((s) => s.to === merchant.phone);
    expect(toMerchant?.message).toContain("₦5,000.00");
    const bodies = sent.map((s) => s.message).join("\n");
    expect(bodies).toContain("Receipt from");
  });

  it("is idempotent on tx-hash replay (no double count)", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app, { quaiAddress: "0xMerchantWallet" });
    const product = await seedProduct(app, merchant.id, 500_000);
    const { order } = await cryptoOrder(app, merchant.id, product.id);

    const rail = cryptoRail(app);
    const paid = rail.chain!.simulatePayment({
      orderId: order.id, merchant: "0xMerchantWallet", token: "0xUSDTMock",
      amount: koboToUsdtUnits(500_000),
    });
    const wh = { headers: {}, rawBody: JSON.stringify({ txHash: paid.txHash }) };
    await app.payments.handleRailWebhook("quai", wh);
    await app.payments.handleRailWebhook("quai", wh); // replay
    await app.payments.handleRailWebhook("quai", wh); // and again

    expect(await app.ledger.entries(merchant.id)).toHaveLength(1);
    expect(await app.ledger.balance(merchant.id)).toBe(500_000);
  });

  it("flags an on-chain amount that underpays beyond FX tolerance", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app, { quaiAddress: "0xMerchantWallet" });
    const product = await seedProduct(app, merchant.id, 500_000);
    const { order } = await cryptoOrder(app, merchant.id, product.id);

    await expect(simulatePay(app, order.id, 500_000, 400_000)).rejects.toBeInstanceOf(ValidationError);
    expect(await app.ledger.entries(merchant.id)).toHaveLength(0);
  });

  it("crypto + fiat sales land in the SAME ledger and the traction snapshot", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app, { quaiAddress: "0xMerchantWallet" });
    const product = await seedProduct(app, merchant.id, 500_000);

    // one crypto sale
    const { order: cryptoOrd } = await cryptoOrder(app, merchant.id, product.id);
    await simulatePay(app, cryptoOrd.id, 500_000);

    // one fiat sale (existing rail)
    const fiatOrder = await app.commerce.createOrder({
      merchantId: merchant.id, buyerRef: "+2348090006666",
      lines: [{ productId: product.id, qty: 1 }],
    });
    const inst = await app.payments.requestPayment(fiatOrder.id);
    const signed = app.fiat.mock!.simulateTransfer(inst.providerRef);
    await app.payments.handleRailWebhook(app.fiat.id, {
      headers: { [app.fiat.webhookSignatureHeader!]: signed.signature },
      rawBody: signed.rawBody,
    });

    expect(await app.ledger.entries(merchant.id)).toHaveLength(2);
    const t = await app.traction.snapshot();
    expect(t.salesCount).toBe(2);
    expect(t.railSplit.crypto).toBe(1);
    expect(t.railSplit.fiat).toBe(1);
    expect(t.gmvKobo).toBe(1_000_000);
    expect(t.uniqueBuyers).toBe(2);
  });
});
