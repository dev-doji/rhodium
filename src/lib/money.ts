/**
 * Money is ALWAYS integer minor units (kobo for NGN). Never floats on the
 * payment path — ledger integrity is non-negotiable.
 */
export type Kobo = number; // integer, >= 0 for amounts

export const NGN = "NGN" as const;

export function assertKobo(amount: number): Kobo {
  if (!Number.isInteger(amount)) {
    throw new Error(`amount must be integer kobo, got ${amount}`);
  }
  if (amount < 0) {
    throw new Error(`amount must be non-negative, got ${amount}`);
  }
  return amount;
}

export function nairaToKobo(naira: number): Kobo {
  return assertKobo(Math.round(naira * 100));
}

export function formatNaira(kobo: Kobo): string {
  const naira = kobo / 100;
  return `₦${naira.toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
