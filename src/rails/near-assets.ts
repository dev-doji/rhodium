/**
 * What a buyer may pay with on the NEAR Intents rail.
 *
 * Deliberately short and hand-checked. 1Click lists ~200 assets; offering all
 * of them puts a scroll of tickers in front of someone at a market stall, and
 * every entry is a chance to send the wrong token on the wrong chain. Each id
 * below was read from 1Click's own GET /v0/tokens on 2026-10-21 rather than
 * copied from a doc, because a wrong asset id quotes a token the buyer does
 * not hold.
 *
 * `evm` is set only where a browser wallet can pay the deposit as a plain
 * ERC-20 transfer — the same path the off-ramp's "Pay from my wallet" uses.
 * Native coins (ETH, SOL, BTC) and non-EVM chains get "copy the address".
 */
export interface NearPayAsset {
  /** 1Click asset id — what goes in the quote as `originAsset`. */
  assetId: string;
  /** What the buyer reads: "USDT · Tron". */
  label: string;
  symbol: string;
  /** 1Click's blockchain id. */
  chain: string;
  /** Chain name as a buyer knows it. */
  chainName: string;
  decimals: number;
  /** Rough USD price, for the MOCK quote only. Live quotes come from 1Click. */
  mockUsdPrice: number;
  evm?: { chainId: number; tokenAddress: string };
}

export const NEAR_PAY_ASSETS: readonly NearPayAsset[] = [
  {
    assetId: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near",
    label: "USDT · Tron",
    symbol: "USDT",
    chain: "tron",
    chainName: "Tron",
    decimals: 6,
    mockUsdPrice: 1,
  },
  {
    assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
    label: "USDC · Base",
    symbol: "USDC",
    chain: "base",
    chainName: "Base",
    decimals: 6,
    mockUsdPrice: 1,
    evm: { chainId: 8453, tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  },
  {
    assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
    label: "USDC · Arbitrum",
    symbol: "USDC",
    chain: "arb",
    chainName: "Arbitrum",
    decimals: 6,
    mockUsdPrice: 1,
    evm: { chainId: 42161, tokenAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" },
  },
  {
    assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
    label: "USDC · Ethereum",
    symbol: "USDC",
    chain: "eth",
    chainName: "Ethereum",
    decimals: 6,
    mockUsdPrice: 1,
    evm: { chainId: 1, tokenAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
  },
  {
    assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
    label: "USDC · Solana",
    symbol: "USDC",
    chain: "sol",
    chainName: "Solana",
    decimals: 6,
    mockUsdPrice: 1,
  },
  {
    // EIGHTEEN decimals: Binance-Peg USDT is not six like everywhere else.
    // Assuming six would ask a wallet for a trillionth of the amount.
    assetId: "nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g",
    label: "USDT · BNB Chain",
    symbol: "USDT",
    chain: "bsc",
    chainName: "BNB Chain",
    decimals: 18,
    mockUsdPrice: 1,
    evm: { chainId: 56, tokenAddress: "0x55d398326f99059ff775485246999027b3197955" },
  },
  {
    assetId: "nep141:eth.omft.near",
    label: "ETH · Ethereum",
    symbol: "ETH",
    chain: "eth",
    chainName: "Ethereum",
    decimals: 18,
    mockUsdPrice: 2500,
  },
  {
    assetId: "nep141:sol.omft.near",
    label: "SOL · Solana",
    symbol: "SOL",
    chain: "sol",
    chainName: "Solana",
    decimals: 9,
    mockUsdPrice: 108,
  },
  {
    assetId: "nep141:btc.omft.near",
    label: "BTC · Bitcoin",
    symbol: "BTC",
    chain: "btc",
    chainName: "Bitcoin",
    decimals: 8,
    mockUsdPrice: 84_000,
  },
];

export function nearPayAsset(assetId: string): NearPayAsset | undefined {
  return NEAR_PAY_ASSETS.find((a) => a.assetId === assetId);
}

/**
 * Whether `address` could be a refund address on `chain`.
 *
 * A shape check, not a proof of ownership. Its job is to catch the common
 * mistake — pasting a Tron address for a Base payment — before 1Click is
 * asked to refund to an address that cannot exist on that chain, where a
 * refund would simply be lost.
 */
export function isRefundAddressFor(chain: string, address: string): boolean {
  const a = address.trim();
  switch (chain) {
    case "eth":
    case "base":
    case "arb":
    case "bsc":
      return /^0x[0-9a-fA-F]{40}$/.test(a);
    case "tron":
      return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a);
    case "sol":
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
    case "btc":
      return /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(a);
    case "near":
      return isNearAccountId(a);
    default:
      return false;
  }
}

/**
 * NEAR account id rules: 2–64 chars of lower-case letters, digits and `-_`
 * separated by dots, or a 64-hex implicit account.
 */
export function isNearAccountId(id: string): boolean {
  if (id.length < 2 || id.length > 64) return false;
  if (/^[0-9a-f]{64}$/.test(id)) return true;
  return /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id);
}
