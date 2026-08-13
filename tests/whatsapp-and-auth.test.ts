import { describe, it, expect } from "vitest";
import { makeApp, seedMerchant, seedProduct } from "./helpers/harness.js";
import { UnauthorizedError } from "../src/lib/errors.js";

describe("WhatsApp merchant flow", () => {
  it("greets an unknown sender and starts onboarding", async () => {
    const app = makeApp();
    const reply = await app.whatsapp.handleInbound({ from: "+2340000000000", text: "hi" });
    expect(reply).toMatch(/Rhodium/);
    expect(reply).toMatch(/business name/i);
  });

  it("onboards a new vendor end-to-end (name → account → bank)", async () => {
    const app = makeApp();
    const phone = "+2348011122233";
    await app.whatsapp.handleInbound({ from: phone, text: "Hi" });
    await app.whatsapp.handleInbound({ from: phone, text: "Amaka Beauty" });
    await app.whatsapp.handleInbound({ from: phone, text: "0123456789" });
    const done = await app.whatsapp.handleInbound({ from: phone, text: "2" }); // GTBank
    expect(done).toMatch(/all set up/i);
    const merchant = await app.repos.merchants.byPhone(phone);
    expect(merchant).not.toBeNull();
    expect(merchant!.businessName).toBe("Amaka Beauty");
    expect(merchant!.settlementAccountNumber).toBe("0123456789");
    expect(merchant!.status).toBe("active");
  });

  it("rejects a bad account number during onboarding", async () => {
    const app = makeApp();
    const phone = "+2348011122244";
    await app.whatsapp.handleInbound({ from: phone, text: "hello" });
    await app.whatsapp.handleInbound({ from: phone, text: "My Shop" });
    const bad = await app.whatsapp.handleInbound({ from: phone, text: "12345" });
    expect(bad).toMatch(/10-digit/i);
  });

  it("adds a product, lists it, and sells it (issuing a DVA)", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);

    const added = await app.whatsapp.handleInbound({ from: merchant.phone, text: "add Lipstick 5000" });
    expect(added).toMatch(/Added \*?Lipstick/);

    const list = await app.whatsapp.handleInbound({ from: merchant.phone, text: "list" });
    expect(list).toMatch(/Lipstick/);

    const products = await app.commerce.listProducts(merchant.id);
    const sell = await app.whatsapp.handleInbound({
      from: merchant.phone,
      text: `sell ${products[0]!.id} 1 +2348090000009`,
    });
    expect(sell).toMatch(/transfer to/i);
    expect(sell).toMatch(/#️⃣ \d{10}/);

    const orders = await app.repos.orders.listByMerchant(merchant.id);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.status).toBe("awaiting_payment");
  });

  it("handles unknown commands gracefully", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    const reply = await app.whatsapp.handleInbound({ from: merchant.phone, text: "asdf" });
    expect(reply).toMatch(/commands/i);
  });

  it("gives the vendor a shareable shop link", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    const reply = await app.whatsapp.handleInbound({ from: merchant.phone, text: "link" });
    expect(reply).toContain(`shop-${merchant.id}`);
  });
});

describe("WhatsApp buyer storefront", () => {
  it("buyer opens a shop link, picks a product, and gets a crypto pay link", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app, { quaiAddress: "0xMerchantWallet" });
    await seedProduct(app, merchant.id, 500_000);
    const buyer = "+2348090005555";

    const catalogue = await app.whatsapp.handleInbound({ from: buyer, text: `shop-${merchant.id}` });
    expect(catalogue).toContain(merchant.businessName);
    expect(catalogue).toMatch(/Red Lipstick/);

    const method = await app.whatsapp.handleInbound({ from: buyer, text: "1" });
    expect(method).toMatch(/how would you like to pay/i);

    const pay = await app.whatsapp.handleInbound({ from: buyer, text: "3" }); // QUAI (BlipPay)
    expect(pay).toMatch(/\/checkout\//);

    const orders = await app.repos.orders.listByMerchant(merchant.id);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.rail).toBe("crypto");
  });

  it("buyer can pay with stablecoin (OnSwitch) — seller receives naira", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    await seedProduct(app, merchant.id, 500_000);
    const buyer = "+2348090007788";
    await app.whatsapp.handleInbound({ from: buyer, text: `shop-${merchant.id}` });
    await app.whatsapp.handleInbound({ from: buyer, text: "1" });
    const pay = await app.whatsapp.handleInbound({ from: buyer, text: "2" }); // stablecoin off-ramp
    expect(pay).toMatch(/USDC|USDT/);
    expect(pay).toMatch(/0x[0-9a-fA-F]{40}/); // deposit address
    expect(pay).toMatch(/in their bank/i); // seller settled in naira
  });

  it("buyer can choose bank transfer and gets account details", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    await seedProduct(app, merchant.id, 300_000);
    const buyer = "+2348090006666";
    await app.whatsapp.handleInbound({ from: buyer, text: `shop-${merchant.id}` });
    await app.whatsapp.handleInbound({ from: buyer, text: "1" });
    const pay = await app.whatsapp.handleInbound({ from: buyer, text: "1" }); // bank
    expect(pay).toMatch(/Transfer to/i);
    expect(pay).toMatch(/\d{10}/);
    const orders = await app.repos.orders.listByMerchant(merchant.id);
    expect(orders[0]!.rail).toBe("fiat");
  });
});

describe("merchant phone-OTP auth", () => {
  it("issues and verifies an OTP, returning a valid session token", async () => {
    const app = makeApp();
    await seedMerchant(app, { phone: "+2348030000123" });

    await app.auth.requestOtp("+2348030000123");
    // OTP was delivered over the WhatsApp channel — pull it from the capture.
    const otpMsg = app.channel.sent.find((s) => s.message.includes("code is"));
    const code = otpMsg!.message.match(/code is (\d{6})/)![1]!;

    const { token, merchantId } = await app.auth.verifyOtp("+2348030000123", code);
    expect(app.auth.verifyToken(token)).toBe(merchantId);
  });

  it("rejects a wrong OTP", async () => {
    const app = makeApp();
    await seedMerchant(app, { phone: "+2348030000124" });
    await app.auth.requestOtp("+2348030000124");
    await expect(app.auth.verifyOtp("+2348030000124", "000000")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it("rejects a tampered token", () => {
    const app = makeApp();
    expect(() => app.auth.verifyToken("mch_x.123.badsig")).toThrow(UnauthorizedError);
  });
});
