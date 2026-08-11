import { describe, it, expect } from "vitest";
import { makeApp, seedMerchant } from "./helpers/harness.js";
import { UnauthorizedError } from "../src/lib/errors.js";

describe("WhatsApp merchant flow", () => {
  it("guides an unregistered number to sign in", async () => {
    const app = makeApp();
    const reply = await app.whatsapp.handleInbound({ from: "+2340000000000", text: "hi" });
    expect(reply).toMatch(/isn't registered/i);
  });

  it("adds a product, lists it, and sells it (issuing a DVA)", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);

    const added = await app.whatsapp.handleInbound({ from: merchant.phone, text: "add Lipstick 5000" });
    expect(added).toMatch(/Added Lipstick/);

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
