import { describe, it, expect } from "vitest";
import { normalisePhone } from "../src/lib/phone.js";

describe("phone normalisation", () => {
  it("collapses every way a Nigerian writes one number onto the same form", () => {
    const canonical = "+2349032621846";
    for (const written of [
      "+2349032621846",
      "2349032621846",
      "09032621846",
      "0903 262 1846",
      "0903-262-1846",
      "(0903) 262 1846",
      "002349032621846",
      // The one that cost a merchant their dashboard: a form prefilled "+234"
      // plus a naturally-typed leading zero.
      "+23409032621846",
    ]) {
      expect(normalisePhone(written)).toBe(canonical);
    }
  });

  it("leaves a foreign number alone", () => {
    expect(normalisePhone("+13038109082")).toBe("+13038109082");
  });

  it("does NOT guess a country for a bare national-length number", () => {
    // "9032621846" could be Nigerian-without-the-zero or North American, and
    // this system already has a +1 merchant. Guessing would hand someone
    // another person's shop, which is worse than asking them to type the code.
    expect(normalisePhone("9032621846")).toBe("+9032621846");
    expect(normalisePhone("3038109082")).toBe("+3038109082");
  });

  it("survives empty and junk input without throwing", () => {
    expect(normalisePhone("")).toBe("");
    expect(normalisePhone("   ")).toBe("");
    expect(normalisePhone("abc")).toBe("");
  });
});

describe("signing in with a naturally-typed number", () => {
  it("reaches the SAME shop whether or not the leading zero is typed", async () => {
    const { makeApp, seedMerchant } = await import("./helpers/harness.js");
    const app = makeApp();
    const shop = await seedMerchant(app, {
      phone: "+2349032621846", businessName: "Circuit City",
    });

    for (const typed of ["+2349032621846", "09032621846", "+23409032621846"]) {
      const found = await app.repos.merchants.byPhone(typed);
      // The middle and last forms are how a Nigerian actually writes it, and a
      // form prefilled "+234" produces the last one. All three are one person.
      expect(found?.id).toBe(shop.id);
    }
  });

  it("refuses to invent a shop for an unrecognised number", async () => {
    const { makeApp } = await import("./helpers/harness.js");
    const app = makeApp();
    await app.auth.requestOtp("+2348099998888");
    const code = app.channel.sent.at(-1)!.message.match(/code is (\d{6})/)![1]!;

    // Signing in used to conjure a blank "New Merchant" here, so the person saw
    // zero sales and concluded their business had disappeared.
    await expect(app.auth.verifyOtp("+2348099998888", code)).rejects.toThrow(/no shop is registered/i);
    expect(await app.repos.merchants.byPhone("+2348099998888")).toBeNull();
  });

  it("verifies even when the two screens are typed differently", async () => {
    const { makeApp, seedMerchant } = await import("./helpers/harness.js");
    const app = makeApp();
    const shop = await seedMerchant(app, { phone: "+2349032621846" });

    await app.auth.requestOtp("09032621846");          // national form
    const code = app.channel.sent.at(-1)!.message.match(/code is (\d{6})/)![1]!;
    const out = await app.auth.verifyOtp("+2349032621846", code); // E.164
    expect(out.merchantId).toBe(shop.id);
  });
});
