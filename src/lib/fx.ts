/**
 * FX between the naira ledger (kobo) and stablecoin base units. The merchant
 * prices in ₦; the buyer pays a stablecoin (USDT, 6 decimals). We convert kobo →
 * token units for the buyer, and the confirmed on-chain amount → kobo before it
 * reaches the ledger, so the books stay single-currency (naira).
 *
 * The rate is a configurable oracle stub for the hackathon. [VALIDATE] — swap in
 * a real price feed for production; this module is the only thing that changes.
 */
import { loadConfig } from "../config/index.js";
import { getFxOracle } from "./fx-oracle.js";
import type { Kobo } from "./money.js";

const USDT_DECIMALS = 6;

/**
 * NGN per USDC — live when the oracle has a rate, else FX_NGN_PER_USD.
 *
 * Reading through the oracle keeps this synchronous: it serves a cached
 * number, never a fetch, so a slow or unreachable price feed can never stall
 * a payment. The configured value is a floor, not the intended source — it
 * sat at 1600 while the market was near 1320, which quietly underpaid every
 * crypto sale by a fifth.
 */
export function ngnPerUsd(): number {
  const live = getFxOracle()?.ngnPerUsd();
  if (Number.isFinite(live) && (live as number) > 0) return live as number;
  const n = Number(loadConfig().FX_NGN_PER_USD);
  if (!Number.isFinite(n) || n <= 0) throw new Error("invalid FX_NGN_PER_USD");
  return n;
}

/** kobo (₦ minor units) → USDT base units (6 dp), as a decimal string. */
export function koboToUsdtUnits(kobo: Kobo): string {
  const naira = kobo / 100;
  const usd = naira / ngnPerUsd();
  const units = Math.round(usd * 10 ** USDT_DECIMALS);
  return String(units);
}

/** USDT base units → kobo (rounded to the nearest kobo). */
export function usdtUnitsToKobo(units: string | bigint | number): Kobo {
  const u = typeof units === "bigint" ? Number(units) : Number(units);
  const usd = u / 10 ** USDT_DECIMALS;
  const naira = usd * ngnPerUsd();
  return Math.round(naira * 100);
}

/** Two amounts (in kobo) are considered equal within a small tolerance (bps). */
export function withinTolerance(a: Kobo, b: Kobo, bps = 100): boolean {
  const diff = Math.abs(a - b);
  const ref = Math.max(Math.abs(a), Math.abs(b), 1);
  return (diff / ref) * 10_000 <= bps;
}

export function humanUsdt(units: string): string {
  const u = Number(units) / 10 ** USDT_DECIMALS;
  return `${u.toFixed(2)} USDT`;
}

/**
 * ₦ (kobo) → a human "≈ 12.50 USDC" for catalogues and payment prompts.
 *
 * Replaces the old QUAI display. Two decimals because USDC is a dollar
 * stablecoin and a buyer reads "12.50" the way she reads a price; six-decimal
 * precision belongs in the transfer, not in the sentence describing it.
 */
export function koboToUsdcDisplay(kobo: Kobo): string {
  const usd = kobo / 100 / ngnPerUsd();
  return `${usd.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`;
}

