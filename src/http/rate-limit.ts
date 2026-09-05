import type { Request } from "express";
import { logger } from "../lib/logger.js";

const log = logger("rate-limit");

/**
 * Fixed-window rate limiting for the handful of public endpoints that cost
 * real money to call.
 *
 * In-memory on purpose. A shared store would be correct across several
 * instances, but this runs as one Render service, and reaching for Redis to
 * protect two endpoints would add a dependency whose own downtime becomes a
 * new way for checkout to fail. The limitation is real and worth stating:
 * running more than one instance divides every limit by the instance count.
 */

interface Window {
  count: number;
  resetAt: number;
}

export interface Decision {
  ok: boolean;
  /** Seconds until the window resets — the value for a Retry-After header. */
  retryAfter: number;
  remaining: number;
}

export class RateLimiter {
  private windows = new Map<string, Window>();
  private lastPrune = 0;

  constructor(private now: () => number = Date.now) {}

  /**
   * Count one hit against `key`. Returns whether it is allowed.
   *
   * Fixed window rather than sliding: a sliding window is fairer at the
   * boundary, but it needs per-hit timestamps, and the abuse this defends
   * against is a loop sending hundreds of requests — which a fixed window
   * stops just as dead, with one integer per key.
   */
  check(key: string, limit: number, windowMs: number): Decision {
    const t = this.now();
    this.prune(t);

    const existing = this.windows.get(key);
    if (!existing || existing.resetAt <= t) {
      this.windows.set(key, { count: 1, resetAt: t + windowMs });
      return { ok: true, retryAfter: 0, remaining: limit - 1 };
    }

    existing.count += 1;
    if (existing.count > limit) {
      return {
        ok: false,
        retryAfter: Math.max(1, Math.ceil((existing.resetAt - t) / 1000)),
        remaining: 0,
      };
    }
    return { ok: true, retryAfter: 0, remaining: limit - existing.count };
  }

  /** Drop expired windows so a long-running process does not grow forever. */
  private prune(t: number): void {
    if (t - this.lastPrune < 60_000) return;
    this.lastPrune = t;
    for (const [key, w] of this.windows) {
      if (w.resetAt <= t) this.windows.delete(key);
    }
  }

  /** Testing seam. */
  reset(): void {
    this.windows.clear();
    this.lastPrune = 0;
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
} as const;

/** Log a refusal once, with enough to tell abuse from a misconfiguration. */
export function logRefusal(kind: string, key: string, retryAfter: number): void {
  log.warn({ kind, key, retryAfter }, "rate limit refused a request");
}
