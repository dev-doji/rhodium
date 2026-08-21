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

function ngnPerUsd(): number {
  const raw = loadConfig().FX_NGN_PER_USD;
  const n = Number(raw);
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

// --- Native QUAI (18 decimals) ---
/**
 * Live rate when the oracle has one, else FX_NGN_PER_QUAI. Reading through the
 * oracle keeps this synchronous — it serves a cached number, never a fetch, so
 * a slow or down price feed can never stall a payment.
 */
export function ngnPerQuai(): number {
  const live = getFxOracle()?.ngnPerQuai();
  if (Number.isFinite(live) && (live as number) > 0) return live as number;
  const n = Number(loadConfig().FX_NGN_PER_QUAI);
  if (!Number.isFinite(n) || n <= 0) throw new Error("invalid FX_NGN_PER_QUAI");
  return n;
}

/** ₦ (kobo) → a human "≈ 393.46 QUAI" for catalogues and instructions. */
export function koboToQuaiDisplay(kobo: Kobo): string {
  const quai = kobo / 100 / ngnPerQuai();
  const dp = quai >= 100 ? 2 : quai >= 1 ? 3 : 6;
  return `${quai.toLocaleString("en-US", { maximumFractionDigits: dp })} QUAI`;
}

/** kobo → QUAI wei (18 dp), as a decimal string (BigInt-safe). */
export function koboToQuaiWei(kobo: Kobo): string {
  const naira = kobo / 100;
  const quai = naira / ngnPerQuai();
  // scale via 1e6 intermediate precision, then to 1e18
  const micro = BigInt(Math.round(quai * 1e6));
  return (micro * 10n ** 12n).toString();
}

/** QUAI wei → kobo. */
export function quaiWeiToKobo(wei: string | bigint): Kobo {
  const w = typeof wei === "bigint" ? wei : BigInt(wei);
  const micro = Number(w / 10n ** 12n); // down to 1e6 units
  const quai = micro / 1e6;
  return Math.round(quai * ngnPerQuai() * 100);
}

export function humanQuai(wei: string): string {
  const q = Number(BigInt(wei) / 10n ** 12n) / 1e6;
  return `${q.toFixed(4)} QUAI`;
}
