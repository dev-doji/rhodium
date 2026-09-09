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

  it("refuses a mock off-ramp when crypto is switched on", () => {
    productionEnv({
      FEATURE_STABLECOIN_ENABLED: "true",
      ONSWITCH_ADAPTER_MODE: "mock",
      ONSWITCH_SERVICE_KEY: "not-real",
    });
    expect(() => loadConfig()).toThrow(/ONSWITCH_ADAPTER_MODE/);
  });

  it("ignores the crypto rails when crypto is switched off", () => {
    // A deployment that does not offer crypto must not be held to a setting it
    // never reads — otherwise the guard becomes a reason to disable the guard.
    productionEnv({
      FEATURE_STABLECOIN_ENABLED: "false",
      ONSWITCH_ADAPTER_MODE: "mock",
      FEATURE_EVM_STABLE_ENABLED: "false",
      EVM_ADAPTER_MODE: "mock",
    });
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
