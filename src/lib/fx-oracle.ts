import { logger } from "./logger.js";

const log = logger("fx-oracle");

export interface RateSnapshot {
  ngnPerQuai: number;
  /** "live" once a fetch has succeeded; "config" while falling back. */
  source: "live" | "config";
  fetchedAt: string | null;
  stale: boolean;
}

/**
 * Live QUAI→NGN rate, cached.
 *
 * The conversion helpers in fx.ts are synchronous and sit on the payment path,
 * so this deliberately does NOT fetch on read. A background refresh keeps a
 * cached number warm and every read is instant; if the feed is unreachable the
 * configured rate is used instead. A price feed being down must never stop a
 * merchant taking money.
 *
 * Nothing fetches until `start()` is called, which keeps the test suite and the
 * demos entirely offline and deterministic.
 */
export class FxOracle {
  private rate: number | null = null;
  private fetchedAt: number | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private fallbackNgnPerQuai: number,
    private ttlMs = 5 * 60 * 1000,
    private fetchImpl: typeof fetch = fetch,
    private url = "https://api.coingecko.com/api/v3/simple/price?ids=quai-network&vs_currencies=ngn",
  ) {}

  /** Cached rate, or the configured fallback. Never throws, never blocks. */
  ngnPerQuai(): number {
    return this.rate ?? this.fallbackNgnPerQuai;
  }

  snapshot(): RateSnapshot {
    const age = this.fetchedAt ? Date.now() - this.fetchedAt : null;
    return {
      ngnPerQuai: this.ngnPerQuai(),
      source: this.rate != null ? "live" : "config",
      fetchedAt: this.fetchedAt ? new Date(this.fetchedAt).toISOString() : null,
      // Surfaced so the checkout page can say "rate may be out of date" rather
      // than quietly showing a price from an hour ago as if it were current.
      stale: age != null ? age > this.ttlMs * 2 : false,
    };
  }

  async refresh(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(this.url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { "quai-network"?: { ngn?: number } };
      const ngn = body["quai-network"]?.ngn;
      if (typeof ngn !== "number" || !Number.isFinite(ngn) || ngn <= 0) {
        throw new Error("no usable ngn rate in response");
      }
      const previous = this.rate;
      this.rate = ngn;
      this.fetchedAt = Date.now();
      if (previous == null || Math.abs(previous - ngn) / ngn > 0.01) {
        log.info({ ngnPerQuai: ngn, previous }, "quai rate updated");
      }
      return true;
    } catch (err) {
      // Keep serving the last good rate. Only the very first failure leaves us
      // on the configured fallback.
      log.warn(
        { err: (err as Error).message, using: this.rate ?? this.fallbackNgnPerQuai },
        "quai rate refresh failed",
      );
      return false;
    }
  }

  /** Begin background refreshing. Safe to call twice. */
  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.ttlMs);
    this.timer.unref?.(); // never hold the process open
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/**
 * Process-wide instance. fx.ts reads through this; wiring it as a singleton
 * rather than threading it through every rail keeps the sync conversion API.
 */
let oracle: FxOracle | null = null;

export function setFxOracle(instance: FxOracle | null): void {
  oracle = instance;
}

export function getFxOracle(): FxOracle | null {
  return oracle;
}
