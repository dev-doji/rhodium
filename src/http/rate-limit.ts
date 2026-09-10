import type { Request } from "express";
import type { SharedStore } from "../modules/state/shared-store.js";
import { logger } from "../lib/logger.js";

const log = logger("rate-limit");

/**
 * Fixed-window rate limiting for the handful of public endpoints that cost
 * real money to call.
 *
 * Backed by shared state rather than process memory. It was in-memory, on the
 * reasoning that this runs as one Render service — true at the time, and the
 * comment here said plainly that a second instance would divide every limit by
 * the instance count. That limitation is now the thing standing between the
 * platform and scaling out, so it is gone: the counter lives in Postgres and is
 * incremented atomically, so ten instances share one window.
 */

export interface Decision {
  ok: boolean;
  /** Seconds until the window resets — the value for a Retry-After header. */
  retryAfter: number;
  remaining: number;
}

export class RateLimiter {
  /**
   * Backed by shared state, so a limit means the same thing on every instance.
   *
   * It used to hold windows in a Map inside one process. With two instances a
   * cap of 3 per 15 minutes silently became 3 x instances — on the endpoint
   * that sends a real WhatsApp message to whatever number is in the request
   * body, which is the one limit that protects someone other than us.
   */
  constructor(private store: SharedStore) {}

  /**
   * Count one hit against `key`. Returns whether it is allowed.
   *
   * Fixed window rather than sliding: a sliding window is fairer at the
   * boundary, but it needs per-hit timestamps, and the abuse this defends
   * against is a loop sending hundreds of requests — which a fixed window stops
   * just as dead, with one integer per key.
   */
  async check(key: string, limit: number, windowMs: number): Promise<Decision> {
    const { count, resetAt } = await this.store.bump(key, windowMs);
    if (count > limit) {
      return {
        ok: false,
        retryAfter: Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000)),
        remaining: 0,
      };
    }
    return { ok: true, retryAfter: 0, remaining: Math.max(0, limit - count) };
  }
}

/**
 * The client's real IP, through Cloudflare and Render.
 *
 * The chain is client -> Cloudflare -> Render -> here, so `req.ip` is a proxy
 * and identical for every visitor. Keying a limit on it would not rate-limit
 * an attacker; it would rate-limit the whole world into one bucket and take
 * the site down the first time anyone was busy.
 *
 * `CF-Connecting-IP` is set by Cloudflare and overwrites anything the client
 * sends, so it cannot be spoofed while traffic arrives through Cloudflare.
 * X-Forwarded-For is the fallback and its leftmost entry IS client-controlled,
 * which is why it is only used when Cloudflare's header is absent, and why the
 * per-phone limit below carries the real weight for OTP.
 */
export function clientIp(req: Request): string {
  const cf = req.header("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.ip ?? "unknown";
}

/**
 * Limits, deliberately generous.
 *
 * A rate limit on a payment path that fires on legitimate use is worse than
 * no limit at all: it turns "someone is abusing us" into "buyers cannot pay".
 * These are set well above what any real person does and well below what a
 * script does in a second.
 */
export const LIMITS = {
  /**
   * One phone number can be sent this many codes per window. This is the
   * limit that matters: it is what stops our number being used to spam a
   * stranger, and the phone comes from the request body, so it identifies the
   * victim no matter where the requests originate.
   */
  otpPerPhone: { limit: 3, windowMs: 15 * 60_000 },
  /** Backstop for one source walking many numbers. */
  otpPerIp: { limit: 20, windowMs: 60 * 60_000 },
  /**
   * Each order creates a customer and a dedicated virtual account at the
   * processor — real records, real cost. A buyer who abandons a cart and comes
   * back a few times stays far under this.
   */
  ordersPerIp: { limit: 30, windowMs: 60 * 60_000 },
  /**
   * Admin sign-in codes, per address.
   *
   * Tighter than the merchant limit because the set of valid addresses is tiny
   * and known to us: anyone hammering this is either locked out or attacking.
   */
  adminOtpPerEmail: { limit: 3, windowMs: 15 * 60_000 },
  adminOtpPerIp: { limit: 10, windowMs: 60 * 60_000 },
  /**
   * Code guesses. AdminAuthService already burns a challenge after 5 wrong
   * attempts; this stops someone requesting fresh codes to keep guessing.
   */
  adminVerifyPerIp: { limit: 20, windowMs: 15 * 60_000 },
} as const;

/** Log a refusal once, with enough to tell abuse from a misconfiguration. */
export function logRefusal(kind: string, key: string, retryAfter: number): void {
  log.warn({ kind, key, retryAfter }, "rate limit refused a request");
}
