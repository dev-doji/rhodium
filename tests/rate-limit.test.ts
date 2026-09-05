import { describe, it, expect } from "vitest";
import type { Request } from "express";
import { RateLimiter, clientIp, LIMITS } from "../src/http/rate-limit.js";

/**
 * The endpoints these guard send real WhatsApp messages and create real
 * records at a payment processor, so the limiter has to be right in two
 * directions: it must actually stop a loop, and it must never fire on a real
 * person. A limit that trips a buyer turns "someone is abusing us" into
 * "buyers cannot pay", which is the worse outage.
 */

/**
 * A Request double carrying only the headers the resolver looks at.
 *
 * `ip` is spread rather than defaulted, so a caller can express "the socket
 * address is missing too" — a default parameter would quietly swallow the
 * undefined and the last-resort branch would never be exercised.
 */
function req(headers: Record<string, string>, ip?: string | null): Request {
  return {
    ...(ip === null ? {} : { ip: ip ?? "10.0.0.1" }),
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

describe("resolving the client behind Cloudflare and Render", () => {
  it("prefers Cloudflare's header, which a client cannot forge", () => {
    // The chain is client -> Cloudflare -> Render -> us, so req.ip is a proxy
    // and the same for everyone. Keying on it would put the whole world in one
    // bucket and take the site down the first time anyone was busy.
    const r = req({
      "cf-connecting-ip": "102.89.1.5",
      "x-forwarded-for": "1.2.3.4, 172.16.0.1",
    });
    expect(clientIp(r)).toBe("102.89.1.5");
  });

  it("falls back to the leftmost forwarded address", () => {
    expect(clientIp(req({ "x-forwarded-for": "102.89.1.5, 172.16.0.1" }))).toBe("102.89.1.5");
  });

  it("falls back to the socket address when there are no proxy headers", () => {
    expect(clientIp(req({}, "10.0.0.9"))).toBe("10.0.0.9");
  });

  it("never returns empty, which would collapse every caller into one bucket", () => {
    expect(clientIp(req({ "x-forwarded-for": "  " }, "10.0.0.9"))).toBe("10.0.0.9");
    expect(clientIp(req({}, null))).toBe("unknown");
  });
});

describe("the limiter", () => {
  it("allows up to the limit and refuses the next one", () => {
    const rl = new RateLimiter();
    for (let i = 0; i < 3; i++) {
      expect(rl.check("k", 3, 1000).ok, `hit ${i + 1} should pass`).toBe(true);
    }
    const refused = rl.check("k", 3, 1000);
    expect(refused.ok).toBe(false);
    // A caller needs to know when to come back, not just that they failed.
    expect(refused.retryAfter).toBeGreaterThan(0);
  });

  it("keeps separate keys separate", () => {
    const rl = new RateLimiter();
    rl.check("a", 1, 1000);
    // One person hitting their limit must never lock out anybody else.
    expect(rl.check("b", 1, 1000).ok).toBe(true);
  });

  it("lets the caller back in once the window passes", () => {
    let now = 1_000_000;
    const rl = new RateLimiter(() => now);
    expect(rl.check("k", 1, 1000).ok).toBe(true);
    expect(rl.check("k", 1, 1000).ok).toBe(false);
    now += 1001;
    expect(rl.check("k", 1, 1000).ok).toBe(true);
  });

  it("forgets expired windows instead of growing forever", () => {
    let now = 1_000_000;
    const rl = new RateLimiter(() => now);
    for (let i = 0; i < 500; i++) rl.check(`k${i}`, 1, 1000);
    now += 120_000; // past both the windows and the prune interval
    rl.check("trigger-prune", 1, 1000);
    const size = (rl as unknown as { windows: Map<string, unknown> }).windows.size;
    expect(size).toBeLessThan(10);
  });
});

describe("the configured limits leave real people alone", () => {
  it("lets someone request a code, mistype it, and try again", () => {
    const rl = new RateLimiter();
    const { limit, windowMs } = LIMITS.otpPerPhone;
    // Three codes in a quarter hour covers a genuine "it didn't arrive" retry.
    for (let i = 0; i < 3; i++) expect(rl.check("otp:phone:+234", limit, windowMs).ok).toBe(true);
    expect(rl.check("otp:phone:+234", limit, windowMs).ok).toBe(false);
  });

  it("stops one source walking many phone numbers", () => {
    const rl = new RateLimiter();
    const { limit, windowMs } = LIMITS.otpPerIp;
    for (let i = 0; i < limit; i++) {
      expect(rl.check("otp:ip:1.2.3.4", limit, windowMs).ok).toBe(true);
    }
    // Each of those would have been a WhatsApp message to a different victim.
    expect(rl.check("otp:ip:1.2.3.4", limit, windowMs).ok).toBe(false);
  });

  it("lets a buyer abandon and rebuild a cart several times over", () => {
    const rl = new RateLimiter();
    const { limit, windowMs } = LIMITS.ordersPerIp;
    // Ten orders in an hour is well past indecisive and still allowed; each
    // one costs a processor customer and a dedicated account, so the ceiling
    // is there for the script, not the shopper.
    for (let i = 0; i < 10; i++) {
      expect(rl.check("order:ip:1.2.3.4", limit, windowMs).ok, `order ${i + 1}`).toBe(true);
    }
    expect(limit).toBeGreaterThanOrEqual(30);
  });
});
