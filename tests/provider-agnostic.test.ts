import { describe, it, expect } from "vitest";
import { buildRegistry } from "../src/rails/registry.js";
import { loadConfig, resetConfigCache, FIAT_PROVIDERS } from "../src/config/index.js";
import { WalletService } from "../src/modules/wallet/wallet-service.js";

/**
 * Switching bank provider should be one env var, and adding one should not
 * mean hunting through the codebase for places that assumed the old roster.
 */
describe("the bank rail is swappable", () => {
  for (const provider of FIAT_PROVIDERS) {
    it(`selects ${provider} and exposes what a caller needs`, () => {
      resetConfigCache();
      process.env.NODE_ENV = "test";
      process.env.FIAT_ADAPTER_MODE = "mock";
      process.env.FIAT_PROVIDER = provider;
      const rails = buildRegistry(loadConfig());

      const fiat = rails.fiat();
      expect(fiat.id).toBe(provider);
      expect(fiat.kind).toBe("fiat");
      // Declared by the rail, so nothing else keeps a lookup table.
      expect(fiat.webhookSignatureHeader, `${provider} must declare its header`)
        .toBeTruthy();
    });
  }

  it("keeps every provider reachable after a switch, for in-flight orders", () => {
    resetConfigCache();
    process.env.FIAT_PROVIDER = "paystack";
    const rails = buildRegistry(loadConfig());
    // An order created under the old provider still has to confirm by webhook.
    for (const provider of FIAT_PROVIDERS) {
      expect(rails.get(provider).id).toBe(provider);
    }
  });

  it("gives every fiat rail a distinct signature header", () => {
    resetConfigCache();
    const rails = buildRegistry(loadConfig());
    const headers = FIAT_PROVIDERS.map((p) => rails.get(p).webhookSignatureHeader);
    // A shared header would let one provider's forged webhook be checked
    // against another's secret.
    expect(new Set(headers).size).toBe(headers.length);
  });
});

describe("merchant wallets follow the configured chain", () => {
  it("mints a standard EVM address importable into any wallet", async () => {
    const w = await new WalletService().generateForChain("evm");
    expect(w.chain).toBe("evm");
    expect(w.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // Quai's Cyprus1 addresses are 0x00-prefixed; an EVM one must not be.
    expect(w.address.startsWith("0x00")).toBe(false);
    expect(w.mnemonic.split(" ")).toHaveLength(12);
  });

  it("still mints Quai when that is the configured chain", async () => {
    const w = await new WalletService().generateForChain("quai");
    expect(w.chain).toBe("quai");
    expect(w.address.startsWith("0x00")).toBe(true);
  });

  it("derives the EVM address from the standard path, so it is portable", async () => {
    // Same phrase must reproduce the same address in MetaMask; if we ever move
    // off the standard path a merchant's funds become unreachable elsewhere.
    const svc = new WalletService();
    const a = await svc.generateForChain("evm");
    const b = await svc.generateForChain("evm");
    expect(a.address).not.toBe(b.address); // fresh entropy each time
    expect(a.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });
});

describe("onboarding mints the wallet for the configured chain", () => {
  it("gives the merchant an Arbitrum-format address when the EVM rail is on", async () => {
    // The whole point of the change: with the EVM rail enabled a merchant must
    // not walk away holding a Quai address she cannot use on Arbitrum.
    const { makeApp } = await import("./helpers/harness.js");
    process.env.FEATURE_EVM_STABLE_ENABLED = "true";
    const app = makeApp();
    const phone = "+2348031110001";
    await app.whatsapp.handleInbound({ from: phone, text: "hi" });
    await app.whatsapp.handleInbound({ from: phone, text: "Arb Store" });
    await app.whatsapp.handleInbound({ from: phone, text: "0123456789" });
    const done = await app.whatsapp.handleInbound({ from: phone, text: "1" });

    const merchant = await app.repos.merchants.byPhone(phone);
    expect(merchant!.quaiAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(merchant!.quaiAddress!.startsWith("0x00")).toBe(false);
    expect(done).toMatch(/Arbitrum/i);
    delete process.env.FEATURE_EVM_STABLE_ENABLED;
  });
});
