import { describe, it, expect, afterEach } from "vitest";
import { FxOracle, setFxOracle } from "../src/lib/fx-oracle.js";
import { koboToQuaiWei, quaiWeiToKobo, koboToQuaiDisplay, ngnPerQuai } from "../src/lib/fx.js";

/** A fetch double returning whatever CoinGecko-shaped body you give it. */
function feed(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

afterEach(() => setFxOracle(null));

describe("live QUAI→NGN oracle", () => {
  it("serves the configured fallback until a fetch succeeds", () => {
    const oracle = new FxOracle(16.5, 1000, feed({}));
    expect(oracle.ngnPerQuai()).toBe(16.5);
    expect(oracle.snapshot().source).toBe("config");
  });

  it("uses the live rate once fetched", async () => {
    const oracle = new FxOracle(16.5, 1000, feed({ "quai-network": { ngn: 21.4 } }));
    expect(await oracle.refresh()).toBe(true);
    expect(oracle.ngnPerQuai()).toBe(21.4);
    const snap = oracle.snapshot();
    expect(snap.source).toBe("live");
    expect(snap.fetchedAt).not.toBeNull();
  });

  it("keeps the last good rate when the feed dies", async () => {
    const oracle = new FxOracle(16.5, 1000, feed({ "quai-network": { ngn: 21.4 } }));
    await oracle.refresh();
    // A price feed going down must never stop a merchant taking money, and must
    // never silently snap prices back to a stale config default either.
    (oracle as unknown as { fetchImpl: typeof fetch }).fetchImpl = feed({}, 500);
    expect(await oracle.refresh()).toBe(false);
    expect(oracle.ngnPerQuai()).toBe(21.4);
  });

  it("rejects a nonsense rate rather than pricing everything at zero", async () => {
    for (const bad of [0, -1, null, "21.4"]) {
      const oracle = new FxOracle(16.5, 1000, feed({ "quai-network": { ngn: bad } }));
      expect(await oracle.refresh()).toBe(false);
      expect(oracle.ngnPerQuai()).toBe(16.5);
    }
  });

  it("drives the conversion helpers once installed", async () => {
    const oracle = new FxOracle(16.5, 1000, feed({ "quai-network": { ngn: 20 } }));
    await oracle.refresh();
    setFxOracle(oracle);

    expect(ngnPerQuai()).toBe(20);
    // ₦6,500 at ₦20/QUAI = 325 QUAI
    expect(koboToQuaiWei(650_000)).toBe("325000000000000000000");
    expect(koboToQuaiDisplay(650_000)).toBe("325 QUAI");
  });

  it("round-trips kobo → wei → kobo", async () => {
    const oracle = new FxOracle(16.5, 1000, feed({ "quai-network": { ngn: 16.52 } }));
    await oracle.refresh();
    setFxOracle(oracle);
    for (const kobo of [650_000, 1_200_000, 9_500_000]) {
      const back = quaiWeiToKobo(koboToQuaiWei(kobo));
      // Rounding through 1e6 intermediate precision, so allow a kobo of drift.
      expect(Math.abs(back - kobo)).toBeLessThanOrEqual(100);
    }
  });

  it("scales the displayed precision to the size of the number", async () => {
    const oracle = new FxOracle(16.5, 1000, feed({ "quai-network": { ngn: 16.5 } }));
    await oracle.refresh();
    setFxOracle(oracle);
    // Hundreds of QUAI do not need six decimals; fractions of one do.
    expect(koboToQuaiDisplay(650_000)).toMatch(/^39[0-9](\.\d{1,2})? QUAI$/);
    expect(koboToQuaiDisplay(100)).toMatch(/QUAI$/);
  });
});

describe("price source fallback", () => {
  /** Routes by URL so each upstream can be failed independently. */
  function routed(map: Record<string, [unknown, number]>): typeof fetch {
    return (async (url: string) => {
      const key = Object.keys(map).find((k) => String(url).includes(k));
      if (!key) return new Response("{}", { status: 404 });
      const [body, status] = map[key]!;
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
  }

  it("falls through to CoinPaprika when CoinGecko rate-limits", async () => {
    // Exactly what Render hits: CoinGecko 429s a shared outbound IP.
    const oracle = new FxOracle(16.5, 1000, routed({
      "coingecko": [{ status: { error_code: 429 } }, 429],
      "coinpaprika": [{ quotes: { USD: { price: 0.012 } } }, 200],
      "er-api": [{ rates: { NGN: 1350 } }, 200],
    }));

    expect(await oracle.refresh()).toBe(true);
    expect(oracle.ngnPerQuai()).toBeCloseTo(16.2, 1); // 0.012 × 1350
    expect(oracle.snapshot().source).toBe("live");
  });

  it("reports failure only when every source is down", async () => {
    const oracle = new FxOracle(16.5, 1000, routed({
      "coingecko": [{}, 429],
      "coinpaprika": [{}, 503],
      "er-api": [{}, 503],
    }));
    expect(await oracle.refresh()).toBe(false);
    expect(oracle.snapshot().source).toBe("config");
  });
});
