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
  /** Quai Cyprus1 (0x00…) or a standard EVM address, depending on the chain. */
  address: string;
  privateKey: string;
  mnemonic: string; // 12-word BIP39 phrase
  /** Which chain family the address belongs to. */
  chain: "quai" | "evm";
}

/**
 * The standard BIP44 path for Ethereum and every EVM chain, Arbitrum included.
 *
 * Using the standard path is the whole point: the merchant can type her twelve
 * words into MetaMask, Rainbow or any wallet and land on the same address. A
 * custom path would strand her funds behind our own software.
 */
const EVM_PATH = "m/44'/60'/0'/0/0";

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
  /** Mint the wallet for a chain family, so callers need not branch. */
  async generateForChain(chain: "quai" | "evm"): Promise<GeneratedWallet> {
    return chain === "evm" ? this.generateEvm() : this.generateCyprus1();
  }

  /**
   * A standard EVM account, for chains like Arbitrum.
   *
   * `quais` is a fork of ethers v6, so it derives an ordinary secp256k1 EOA at
   * the Ethereum path — no second crypto dependency for one key derivation.
   */
  async generateEvm(): Promise<GeneratedWallet> {
    const lib = q();
    const mnemonic = lib.Mnemonic.fromEntropy(lib.randomBytes(16));
    const wallet = lib.HDNodeWallet.fromMnemonic(mnemonic, EVM_PATH);
    // Never log secrets — only the public address.
    log.info({ address: wallet.address, chain: "evm" }, "generated merchant wallet");
    return {
      address: wallet.address,
      privateKey: wallet.privateKey,
      mnemonic: mnemonic.phrase,
      chain: "evm",
    };
  }

  async generateCyprus1(): Promise<GeneratedWallet> {
    const lib = q();
    const mnemonic = lib.Mnemonic.fromEntropy(lib.randomBytes(16));
    const hd = lib.QuaiHDWallet.fromMnemonic(mnemonic);
    const info = await hd.getNextAddress(0, lib.Zone.Cyprus1);
    const privateKey = hd.getPrivateKey(info.address);
    // Never log secrets — only the public address.
    log.info({ address: info.address, chain: "quai" }, "generated merchant wallet");
    return { address: info.address, privateKey, mnemonic: mnemonic.phrase, chain: "quai" };
  }
}
