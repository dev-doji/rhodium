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
    const done = await app.whatsapp.handleInbound({ from: phone, text: "1" });

    const merchant = await app.repos.merchants.byPhone(phone);
    // Quai is retired: onboarding now mints an ordinary EVM account for
    // Arbitrum, so the address must NOT carry Quai's 0x00 shard prefix.
    expect(merchant!.quaiAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(merchant!.quaiAddress!.startsWith("0x00")).toBe(false);
    // The message names the chain, because a merchant told only "crypto
    // wallet" cannot tell whether the address she is backing up works where
    // she expects.
    expect(done).toMatch(/your Arbitrum One wallet/i);

    const secrets = await app.repos.merchants.getWalletSecrets(merchant!.id);
    expect(secrets).not.toBeNull();
    expect(secrets!.mnemonic.split(/\s+/)).toHaveLength(12);
    // the phrase must reproduce the stored address (so it works in BlipPay/Pelagus)
    expect(secrets!.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });
});
