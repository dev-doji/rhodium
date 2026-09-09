import { describe, it, expect } from "vitest";
import { makeApp } from "./helpers/harness.js";
import { WalletService } from "../src/modules/wallet/wallet-service.js";

describe("embedded Quai wallet", () => {
  it("generates a valid Cyprus1 EOA with a 12-word phrase", async () => {
    const w = await new WalletService().generateCyprus1();
    expect(w.address).toMatch(/^0x00[0-9a-fA-F]{38}$/); // Cyprus1 = 0x00 prefix
    expect(w.mnemonic.trim().split(/\s+/)).toHaveLength(12);
    expect(w.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it("onboarding creates + stores an embedded wallet, revealable via the vault", async () => {
    const app = makeApp();
    const phone = "+2348012345600";
    await app.whatsapp.handleInbound({ from: phone, text: "Hi" });
    await app.whatsapp.handleInbound({ from: phone, text: "Wallet Store" });
    await app.whatsapp.handleInbound({ from: phone, text: "0123456789" });
    await app.whatsapp.handleInbound({ from: phone, text: "1" });
    // crypto settlement: USDC into a wallet
    const done = await app.whatsapp.handleInbound({ from: phone, text: "2" });

    const merchant = await app.repos.merchants.byPhone(phone);
    expect(merchant!.quaiAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // The message names the chain, because a merchant told only "crypto
    // wallet" cannot tell whether the address she is backing up works where
    // she expects.
    expect(done).toMatch(/your Arbitrum One wallet/i);

    const secrets = await app.repos.merchants.getWalletSecrets(merchant!.id);
    expect(secrets).not.toBeNull();
    expect(secrets!.mnemonic.split(/\s+/)).toHaveLength(12);
    expect(secrets!.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);

    // The phrase must reproduce the stored address, or a merchant who backs it
    // up and restores it elsewhere gets a different wallet and cannot reach her
    // money. This is also what proves the account is an ORDINARY EVM one and
    // not a Quai shard address: the derivation is Ethereum's coin type,
    // m/44'/60'/0'/0/0.
    //
    // This replaced an assertion that the address does not begin "0x00". Quai's
    // Cyprus1 addresses do begin that way — but so does roughly one in every
    // 256 perfectly ordinary EVM addresses, so the check failed at random. It
    // did exactly that during this run, which is how it was found.
    // `quais`, not `ethers`. The app derives keys with quais — a fork of
    // ethers v6 — precisely so there is no second crypto dependency, and
    // ethers is not in this package at all. It resolved locally only because
    // the chain/ workspace pulls it in for Hardhat, so this passed here and
    // failed the moment CI installed without workspaces.
    const { createRequire } = await import("node:module");
    const require_ = createRequire(import.meta.url);
    const quais = require_("quais");
    const derived = quais.HDNodeWallet.fromMnemonic(
      quais.Mnemonic.fromPhrase(secrets!.mnemonic),
      "m/44'/60'/0'/0/0",
    );
    expect(derived.address.toLowerCase()).toBe(merchant!.quaiAddress!.toLowerCase());
  });
});
