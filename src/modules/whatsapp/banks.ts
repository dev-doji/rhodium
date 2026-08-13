/**
 * Common Nigerian banks + NIBSS institution codes (as returned by OnSwitch's
 * GET /institution?country=NG). These are the codes used to settle the crypto→
 * naira off-ramp to the merchant's bank, so they must match the provider's list.
 */
export interface Bank {
  name: string;
  code: string;
}

export const BANKS: Bank[] = [
  { name: "Access Bank", code: "000014" },
  { name: "GTBank", code: "000013" },
  { name: "Zenith Bank", code: "000015" },
  { name: "First Bank", code: "000016" },
  { name: "UBA", code: "000004" },
  { name: "Opay", code: "100004" },
  { name: "PalmPay", code: "100033" },
  { name: "Kuda", code: "090267" },
  { name: "Moniepoint", code: "090405" },
  { name: "Wema Bank", code: "000017" },
];

export function bankMenu(): string {
  return BANKS.map((b, i) => `${i + 1}) ${b.name}`).join("\n");
}

/** Resolve a bank from a reply — a list number, or a name substring. */
export function pickBank(text: string): Bank | null {
  const n = parseInt(text.trim(), 10);
  if (!Number.isNaN(n) && n >= 1 && n <= BANKS.length) return BANKS[n - 1]!;
  const t = text.trim().toLowerCase();
  return BANKS.find((b) => b.name.toLowerCase().includes(t)) ?? null;
}
