import { logger } from "./logger.js";

const log = logger("fx-oracle");

type Getter = (url: string) => Promise<Response>;

export interface PriceSource {
  name: string;
  /** Returns NGN per USDC, or throws. */
  read(get: Getter): Promise<number>;
}

async function json<T>(get: Getter, url: string): Promise<T> {
  const res = await get(url);
  if (!res.ok) throw new Error(`status ${res.status}`);
  return (await res.json()) as T;
}

/**
 * NGN per USDC, ordered by directness.
 *
 * The first source quotes USDC in naira directly, which is the number that
 * matters: USDC is a dollar stablecoin but it does not trade at the official
 * USD/NGN rate in Nigeria, and pricing off the interbank rate would quote
 * every buyer a figure they cannot actually transact at.
 *
 * CoinGecko rate-limits hard by IP and a shared host (Render) is often already
 * over the limit, so the keyless fallbacks matter more than they look. The
 * last one multiplies USDC/USD by the official USD/NGN — a worse number, but
 * a working one when the direct quotes are unreachable.
 */
export const DEFAULT_SOURCES: PriceSource[] = [
  {
    name: "coingecko",
    async read(get) {
      const b = await json<{ "usd-coin"?: { ngn?: number } }>(
        get,
        "https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=ngn",
      );
      const ngn = b["usd-coin"]?.ngn;
      if (typeof ngn !== "number") throw new Error("no ngn in response");
      return ngn;
    },
  },
  {
    name: "coinpaprika+erapi",
    async read(get) {
      const [coin, fx] = await Promise.all([
        json<{ quotes?: { USD?: { price?: number } } }>(
          get,
          "https://api.coinpaprika.com/v1/tickers/usdc-usd-coin?quotes=USD",
        ),
        json<{ rates?: { NGN?: number } }>(get, "https://open.er-api.com/v6/latest/USD"),
      ]);
      const usd = coin.quotes?.USD?.price;
      const ngnPerUsd = fx.rates?.NGN;
      if (typeof usd !== "number" || typeof ngnPerUsd !== "number") {
        throw new Error("missing usd price or ngn rate");
      }
      return usd * ngnPerUsd;
    },
  },
];

export interface RateSnapshot {
  ngnPerUsd: number;
  /** "live" once a fetch has succeeded; "config" while falling back. */
  source: "live" | "config";
  fetchedAt: string | null;
  stale: boolean;
}

/**
 * Live USDC→NGN rate, cached.
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
    private fallbackNgnPerUsd: number,
    private ttlMs = 5 * 60 * 1000,
    private fetchImpl: typeof fetch = fetch,
    /** Tried in order until one yields a usable rate. */
    private sources: PriceSource[] = DEFAULT_SOURCES,
  ) {}

  /** Cached rate, or the configured fallback. Never throws, never blocks. */
  ngnPerUsd(): number {
    return this.rate ?? this.fallbackNgnPerUsd;
  }

  snapshot(): RateSnapshot {
    const age = this.fetchedAt ? Date.now() - this.fetchedAt : null;
    return {
      ngnPerUsd: this.ngnPerUsd(),
      source: this.rate != null ? "live" : "config",
      fetchedAt: this.fetchedAt ? new Date(this.fetchedAt).toISOString() : null,
      // Surfaced so the checkout page can say "rate may be out of date" rather
      // than quietly showing a price from an hour ago as if it were current.
      stale: age != null ? age > this.ttlMs * 2 : false,
    };
  }

  private get(url: string): Promise<Response> {
    return this.fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
  }

  async refresh(): Promise<boolean> {
    const failures: string[] = [];
    for (const source of this.sources) {
      try {
        const ngn = await source.read((u) => this.get(u));
        if (typeof ngn !== "number" || !Number.isFinite(ngn) || ngn <= 0) {
          throw new Error("no usable rate");
        }
        const previous = this.rate;
        this.rate = ngn;
        this.fetchedAt = Date.now();
        if (previous == null || Math.abs(previous - ngn) / ngn > 0.01) {
          log.info({ ngnPerUsd: ngn, previous, source: source.name }, "usdc/ngn rate updated");
        }
        return true;
      } catch (err) {
        failures.push(`${source.name}: ${(err as Error).message}`);
      }
    }
    // Keep serving the last good rate. Only a cold start leaves us on the
    // configured fallback — a price feed being down must not stop a sale.
    log.warn(
      { failures, using: this.rate ?? this.fallbackNgnPerUsd },
      "every usdc/ngn rate source failed",
    );
    return false;
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
