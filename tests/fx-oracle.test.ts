import { describe, it, expect, afterEach } from "vitest";
import { FxOracle, setFxOracle } from "../src/lib/fx-oracle.js";
import {
  koboToUsdtUnits,
  usdtUnitsToKobo,
  koboToUsdcDisplay,
  ngnPerUsd,
} from "../src/lib/fx.js";

/** A fetch double returning whatever CoinGecko-shaped body you give it. */
function feed(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

afterEach(() => setFxOracle(null));

describe("live USDC→NGN oracle", () => {
  it("serves the configured fallback until a fetch succeeds", () => {
    const oracle = new FxOracle(1600, 1000, feed({}));
    expect(oracle.ngnPerUsd()).toBe(1600);
    expect(oracle.snapshot().source).toBe("config");
  });

  it("uses the live rate once fetched", async () => {
    const oracle = new FxOracle(1600, 1000, feed({ "usd-coin": { ngn: 1321.65 } }));
    expect(await oracle.refresh()).toBe(true);
    expect(oracle.ngnPerUsd()).toBe(1321.65);
    const snap = oracle.snapshot();
    expect(snap.source).toBe("live");
    expect(snap.fetchedAt).not.toBeNull();
  });

  it("keeps the last good rate when the feed dies", async () => {
    const oracle = new FxOracle(1600, 1000, feed({ "usd-coin": { ngn: 1321.65 } }));
    await oracle.refresh();
    // A price feed going down must never stop a merchant taking money, and must
    // never silently snap prices back to a stale config default either.
    (oracle as unknown as { fetchImpl: typeof fetch }).fetchImpl = feed({}, 500);
    expect(await oracle.refresh()).toBe(false);
    expect(oracle.ngnPerUsd()).toBe(1321.65);
  });

  it("rejects a nonsense rate rather than pricing everything at zero", async () => {
    for (const bad of [0, -1, null, "1321.65"]) {
      const oracle = new FxOracle(1600, 1000, feed({ "usd-coin": { ngn: bad } }));
      expect(await oracle.refresh()).toBe(false);
      expect(oracle.ngnPerUsd()).toBe(1600);
    }
  });

  it("drives the conversion helpers once installed", async () => {
    const oracle = new FxOracle(1600, 1000, feed({ "usd-coin": { ngn: 1300 } }));
    await oracle.refresh();
    setFxOracle(oracle);

    expect(ngnPerUsd()).toBe(1300);
    // ₦13,000 at ₦1,300/USDC = 10 USDC = 10,000,000 base units (6 dp)
    expect(koboToUsdtUnits(13_000_00)).toBe("10000000");
    expect(koboToUsdcDisplay(13_000_00)).toBe("10 USDC");
  });

  it("prices off the live rate, not the configured one", async () => {
    // The bug this guards: the config sat at 1600 while the market was near
    // 1320, so every crypto order quoted about a fifth too little USDC and
    // underpaid the merchant by that much.
    const stale = 1600;
    const live = 1320;
    const price = 16_000_00; // ₦16,000

    const oracle = new FxOracle(stale, 1000, feed({ "usd-coin": { ngn: live } }));
    await oracle.refresh();
    setFxOracle(oracle);

    const atLive = Number(koboToUsdtUnits(price));
    const atStale = (price / 100 / stale) * 1e6;
    expect(atLive).toBeGreaterThan(atStale);
    // ₦16,000 is 12.12 USDC at 1320, not 10.00 at 1600.
    expect(atLive).toBe(12121212);
  });

  it("round-trips kobo → base units → kobo", async () => {
    const oracle = new FxOracle(1600, 1000, feed({ "usd-coin": { ngn: 1321.65 } }));
    await oracle.refresh();
    setFxOracle(oracle);
    const kobo = 25_000_00;
    // Rounding is to the nearest kobo, so allow a kobo of drift rather than
    // pretending the conversion is exact.
    expect(Math.abs(usdtUnitsToKobo(koboToUsdtUnits(kobo)) - kobo)).toBeLessThanOrEqual(1);
  });
});
