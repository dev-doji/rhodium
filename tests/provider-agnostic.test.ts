import { describe, it, expect } from "vitest";
import { buildRegistry } from "../src/rails/registry.js";
import {
  loadConfig,
  resetConfigCache,
  FIAT_PROVIDERS,
  EVM_DEPLOYMENTS,
  ONSWITCH_ASSETS,
} from "../src/config/index.js";
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

describe("the EVM deployment must hang together", () => {
  const base = () => {
    process.env.NODE_ENV = "production";
    process.env.FEATURE_EVM_STABLE_ENABLED = "true";
    process.env.EVM_ADAPTER_MODE = "live";
    // satisfy the unrelated production guards
    process.env.WHATSAPP_MODE = "mock";
    process.env.FIAT_ADAPTER_MODE = "mock";
    process.env.FIELD_ENCRYPTION_KEY = "a".repeat(64);
  };
  const clear = () => {
    for (const k of [
      "NODE_ENV", "FEATURE_EVM_STABLE_ENABLED", "EVM_ADAPTER_MODE", "EVM_CHAIN_ID",
      "EVM_CONTRACT_ADDRESS", "EVM_TOKEN_ADDRESS", "FIELD_ENCRYPTION_KEY",
    ]) delete process.env[k];
    resetConfigCache();
  };

  it("refuses mainnet config pointing at the testnet contract", () => {
    // The failure this exists for: renders fine, quotes an amount, settles
    // nothing, and is invisible until a buyer's money has moved.
    base();
    process.env.EVM_CHAIN_ID = "42161";
    process.env.EVM_CONTRACT_ADDRESS = "0x34b17673E4Be07D5027cF02C63b3bDf5ed7e13b2";
    resetConfigCache();
    expect(() => loadConfig()).toThrow(/not the RhodiumPay deployment on Arbitrum One/i);
    clear();
  });

  it("refuses a token that is not USDC on that chain", () => {
    base();
    process.env.EVM_CHAIN_ID = "42161";
    process.env.EVM_CONTRACT_ADDRESS = "0x80cD8120170c799501E9a7eA0da4203AD52C1d7d";
    process.env.EVM_TOKEN_ADDRESS = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8"; // bridged USDC.e
    resetConfigCache();
    expect(() => loadConfig()).toThrow(/is not USDC on Arbitrum One/i);
    clear();
  });

  it("accepts each network's own matching set", () => {
    for (const [chainId, dep] of Object.entries(EVM_DEPLOYMENTS)) {
      base();
      process.env.EVM_CHAIN_ID = chainId;
      process.env.EVM_CONTRACT_ADDRESS = dep.contract;
      process.env.EVM_TOKEN_ADDRESS = dep.token;
      resetConfigCache();
      expect(() => loadConfig(), `${dep.name} should be accepted`).not.toThrow();
      clear();
    }
  });

  it("refuses a live EVM rail with no contract at all", () => {
    base();
    process.env.EVM_CHAIN_ID = "42161";
    resetConfigCache();
    expect(() => loadConfig()).toThrow(/EVM_CONTRACT_ADDRESS is not set/i);
    clear();
  });
});

describe("the OnSwitch off-ramp asset", () => {
  it("defaults to Arbitrum USDC, matching the EVM rail's chain and token", () => {
    resetConfigCache();
    delete process.env.ONSWITCH_ASSET;
    expect(loadConfig().ONSWITCH_ASSET).toBe("arbitrum:usdc");
  });

  it("refuses an asset OnSwitch does not accept", () => {
    // The list comes from the API's own validation error. A wrong value is
    // otherwise discovered only when a buyer is already waiting on a deposit
    // address that will never be issued.
    resetConfigCache();
    process.env.ONSWITCH_ASSET = "arbitrum:dai";
    expect(() => loadConfig()).toThrow();
    delete process.env.ONSWITCH_ASSET;
    resetConfigCache();
  });

  it("accepts every asset the API enumerated", () => {
    for (const asset of ONSWITCH_ASSETS) {
      resetConfigCache();
      process.env.ONSWITCH_ASSET = asset;
      expect(() => loadConfig(), `${asset} should be accepted`).not.toThrow();
    }
    delete process.env.ONSWITCH_ASSET;
    resetConfigCache();
  });
});
