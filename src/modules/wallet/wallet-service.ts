import { createRequire } from "node:module";
import { logger } from "../../lib/logger.js";

// quais (the Quai SDK) is CommonJS-only under our ESM setup, so bridge with
// createRequire. We use it OFFLINE (key generation) — never the network provider.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let quais: any;
function q(): any {
  if (!quais) quais = require("quais");
  return quais;
}

const log = logger("wallet");

export interface GeneratedWallet {
  address: string; // Cyprus1 Quai address (0x00…)
  privateKey: string;
  mnemonic: string; // 12-word BIP39 phrase
}

/**
 * Generates a self-custody-style Quai EOA for a merchant (embedded wallet).
 * The Quai SDK derives the mnemonic + Cyprus1 address so the phrase reproduces
 * the same address when the merchant imports it into BlipPay/Pelagus.
 *
 * SECURITY: the returned secrets must be encrypted before storage and only ever
 * revealed to the authenticated merchant over HTTPS behind OTP — never logged,
 * never sent over WhatsApp.
 */
export class WalletService {
  async generateCyprus1(): Promise<GeneratedWallet> {
    const lib = q();
    const mnemonic = lib.Mnemonic.fromEntropy(lib.randomBytes(16));
    const hd = lib.QuaiHDWallet.fromMnemonic(mnemonic);
    const info = await hd.getNextAddress(0, lib.Zone.Cyprus1);
    const privateKey = hd.getPrivateKey(info.address);
    // Never log secrets — only the public address.
    log.info({ address: info.address }, "generated merchant wallet");
    return { address: info.address, privateKey, mnemonic: mnemonic.phrase };
  }
}
