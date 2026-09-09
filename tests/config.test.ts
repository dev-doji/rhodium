import { describe, it, expect, afterEach } from "vitest";
import { loadConfig, resetConfigCache } from "../src/config/index.js";

/**
 * Boot-time guards.
 *
 * These exist because the failures they prevent are silent. A mock rail does
 * not error — it confirms the payment, credits the ledger and sends a receipt,
 * with no money anywhere. Nothing in the logs looks wrong.
 */
const SAVED = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in SAVED)) delete process.env[key];
  }
  Object.assign(process.env, SAVED);
  resetConfigCache();
});

/** A production environment that is otherwise valid, so only one thing is under test. */
function productionEnv(over: Record<string, string> = {}) {
  resetConfigCache();
  Object.assign(process.env, {
    NODE_ENV: "production",
    FIAT_ADAPTER_MODE: "live",
    FIAT_PROVIDER: "paystack",
    PAYSTACK_SECRET_KEY: "sk_test_notreal",
    WHATSAPP_MODE: "mock",
    EMAIL_MODE: "mock",
    FIELD_ENCRYPTION_KEY: "a".repeat(64),
    APP_SECRET: "not-the-real-secret",
    FEATURE_STABLECOIN_ENABLED: "false",
    FEATURE_EVM_STABLE_ENABLED: "false",
    ...over,
  });
}

describe("production refuses to serve with a mock money rail", () => {
  it("boots when the bank rail is live", () => {
    productionEnv();
    expect(() => loadConfig()).not.toThrow();
  });

  it("refuses a mock bank rail", () => {
    // The one that matters most: every naira sale goes through this rail.
    productionEnv({ FIAT_ADAPTER_MODE: "mock" });
    expect(() => loadConfig()).toThrow(/FIAT_ADAPTER_MODE.*mock/is);
  });

  it("still boots with a mock CRYPTO rail, because crypto is optional", () => {
    // This guard used to cover the crypto rails too, and that was wrong:
    // FEATURE_EVM_STABLE_ENABLED defaults to true while EVM_ADAPTER_MODE
    // defaults to mock, so the DEFAULT configuration could not start — three
    // deploys of unrelated fixes died on it while the old build kept serving.
    //
    // A crypto rail is optional, so the safe answer is to withhold the rail
    // rather than the service. buildRailRegistry refuses to register it; see
    // the registry tests below.
    productionEnv({
      FEATURE_STABLECOIN_ENABLED: "true",
      ONSWITCH_ADAPTER_MODE: "mock",
      FEATURE_EVM_STABLE_ENABLED: "true",
      EVM_ADAPTER_MODE: "mock",
    });
    expect(() => loadConfig()).not.toThrow();
  });

  it("boots on the defaults, which is the whole point", () => {
    // The regression that mattered: nothing crypto-related set at all.
    productionEnv();
    delete process.env.FEATURE_EVM_STABLE_ENABLED;
    delete process.env.FEATURE_STABLECOIN_ENABLED;
    delete process.env.EVM_ADAPTER_MODE;
    delete process.env.ONSWITCH_ADAPTER_MODE;
    expect(() => loadConfig()).not.toThrow();
  });

  it("says which variable is wrong, not just that something is", () => {
    productionEnv({ FIAT_ADAPTER_MODE: "mock" });
    try {
      loadConfig();
      throw new Error("expected a refusal");
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain("FIAT_ADAPTER_MODE");
      // And why it matters, so whoever hits it at 2am does not just flip it back.
      expect(message).toMatch(/never happened/i);
    }
  });

  it("still allows mock rails outside production", () => {
    // Every test in this suite, and every local run, depends on this.
    resetConfigCache();
    process.env.NODE_ENV = "test";
    process.env.FIAT_ADAPTER_MODE = "mock";
    process.env.ONSWITCH_ADAPTER_MODE = "mock";
    expect(() => loadConfig()).not.toThrow();
  });
});

describe("a mock crypto rail is withheld in production, not fatal", () => {
  it("does not register a mock off-ramp in production", async () => {
    // The rail is absent rather than present-and-lying. A registered mock rail
    // would confirm crypto payments that never happened; an absent one simply
    // is not offered, and the checkout already gates on what a merchant can
    // actually use.
    productionEnv({ FEATURE_STABLECOIN_ENABLED: "true", ONSWITCH_ADAPTER_MODE: "mock" });
    const { buildRegistry } = await import("../src/rails/registry.js");
    const registry = buildRegistry(loadConfig());
    expect(registry.find("onswitch")).toBeNull();
  });

  it("does not register a mock EVM rail in production", async () => {
    productionEnv({ FEATURE_EVM_STABLE_ENABLED: "true", EVM_ADAPTER_MODE: "mock" });
    const { buildRegistry } = await import("../src/rails/registry.js");
    const registry = buildRegistry(loadConfig());
    expect(registry.find("evm_stable")).toBeNull();
  });

  it("registers a LIVE crypto rail in production", async () => {
    productionEnv({
      FEATURE_STABLECOIN_ENABLED: "true",
      ONSWITCH_ADAPTER_MODE: "live",
      ONSWITCH_SERVICE_KEY: "not-a-real-key",
    });
    const { buildRegistry } = await import("../src/rails/registry.js");
    const registry = buildRegistry(loadConfig());
    expect(registry.find("onswitch")).not.toBeNull();
  });

  it("still registers mock rails outside production, or every test would fail", async () => {
    resetConfigCache();
    process.env.NODE_ENV = "test";
    process.env.FIAT_ADAPTER_MODE = "mock";
    process.env.ONSWITCH_ADAPTER_MODE = "mock";
    const { buildRegistry } = await import("../src/rails/registry.js");
    const registry = buildRegistry(loadConfig());
    expect(registry.find("onswitch")).not.toBeNull();
  });

  it("leaves the bank rail reachable when a crypto rail is withheld", async () => {
    // The point of the change: one unconfigured optional rail must not take
    // the shop down with it.
    productionEnv({ FEATURE_EVM_STABLE_ENABLED: "true", EVM_ADAPTER_MODE: "mock" });
    const { buildRegistry } = await import("../src/rails/registry.js");
    const registry = buildRegistry(loadConfig());
    expect(registry.fiat()).toBeTruthy();
  });
});
