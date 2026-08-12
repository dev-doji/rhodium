/**
 * Common Nigerian banks + NIP/Paystack bank codes, for the onboarding flow.
 * [VALIDATE] the codes against Paystack's GET /bank before going live — they
 * are used to create the merchant's settlement subaccount.
 */
export interface Bank {
  name: string;
  code: string;
}

export const BANKS: Bank[] = [
  { name: "Access Bank", code: "044" },
  { name: "GTBank", code: "058" },
  { name: "Zenith Bank", code: "057" },
  { name: "First Bank", code: "011" },
  { name: "UBA", code: "033" },
  { name: "Opay", code: "999992" },
  { name: "PalmPay", code: "999991" },
  { name: "Kuda", code: "50211" },
  { name: "Moniepoint", code: "50515" },
  { name: "Wema Bank", code: "035" },
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
