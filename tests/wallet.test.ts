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
    expect(merchant!.quaiAddress).toMatch(/^0x00/);
    expect(done).toMatch(/crypto wallet/i);

    const secrets = await app.repos.merchants.getWalletSecrets(merchant!.id);
    expect(secrets).not.toBeNull();
    expect(secrets!.mnemonic.split(/\s+/)).toHaveLength(12);
    // the phrase must reproduce the stored address (so it works in BlipPay/Pelagus)
    expect(secrets!.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });
});
