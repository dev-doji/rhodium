/**
 * Nigerian banks, with the code each provider uses for them.
 *
 * There is no single national code. NIBSS institution codes (`000014`) are
 * what OnSwitch and Monnify want; Paystack has its own shorter scheme (`044`)
 * and rejects anything else with a bare 400. The old list held only the NIBSS
 * set, so when the fiat provider became Paystack every subaccount creation
 * failed — silently, because onboarding logs that failure and carries on. The
 * result was merchants who looked fully onboarded and could not be paid.
 *
 * So a bank is identified internally by `id`, and each rail asks for the code
 * in its own scheme. `settlementBankCode` on a merchant may hold either an
 * `id` or a raw code from any provider — `bankCodeFor` accepts all of them, so
 * merchants onboarded before this change keep working.
 */

export type BankProvider = "paystack" | "nibss";

export interface Bank {
  /** Stable internal identity; never sent to a provider. */
  id: string;
  name: string;
  codes: Record<BankProvider, string>;
}

/**
 * A curated menu, not every bank in Nigeria.
 *
 * Paystack lists 282 institutions. That is the right source for validation and
 * hopeless as a WhatsApp menu, so this is the handful a Nigerian trader
 * actually uses, in rough order of how often.
 */
export const BANKS: Bank[] = [
  { id: "opay", name: "Opay", codes: { paystack: "999992", nibss: "100004" } },
  { id: "palmpay", name: "PalmPay", codes: { paystack: "999991", nibss: "100033" } },
  { id: "kuda", name: "Kuda", codes: { paystack: "50211", nibss: "090267" } },
  { id: "moniepoint", name: "Moniepoint", codes: { paystack: "50515", nibss: "090405" } },
  { id: "access", name: "Access Bank", codes: { paystack: "044", nibss: "000014" } },
  { id: "gtbank", name: "GTBank", codes: { paystack: "058", nibss: "000013" } },
  { id: "zenith", name: "Zenith Bank", codes: { paystack: "057", nibss: "000015" } },
  { id: "firstbank", name: "First Bank", codes: { paystack: "011", nibss: "000016" } },
  { id: "uba", name: "UBA", codes: { paystack: "033", nibss: "000004" } },
  { id: "wema", name: "Wema Bank", codes: { paystack: "035", nibss: "000017" } },
  { id: "sterling", name: "Sterling Bank", codes: { paystack: "232", nibss: "000001" } },
  { id: "fidelity", name: "Fidelity Bank", codes: { paystack: "070", nibss: "000007" } },
];

export function bankMenu(): string {
  return BANKS.map((b, i) => `${i + 1}) ${b.name}`).join("\n");
}

/** Resolve a bank from a reply — a list number, or a name substring. */
export function pickBank(text: string): Bank | null {
  const n = parseInt(text.trim(), 10);
  if (!Number.isNaN(n) && n >= 1 && n <= BANKS.length) return BANKS[n - 1]!;
  const t = text.trim().toLowerCase();
  if (!t) return null;
  return BANKS.find((b) => b.name.toLowerCase().includes(t) || b.id === t) ?? null;
}

/** Find a bank by its id or by any provider code we know it under. */
export function findBank(idOrCode: string): Bank | null {
  const v = idOrCode.trim().toLowerCase();
  return (
    BANKS.find(
      (b) =>
        b.id === v ||
        Object.values(b.codes).some((c) => c.toLowerCase() === v),
    ) ?? null
  );
}

/**
 * The code `provider` expects for whatever is stored on the merchant.
 *
 * Returns the input unchanged when the bank is not in the curated list: a
 * merchant may legitimately bank somewhere we do not menu, and passing the
 * stored value through lets the provider be the one to reject it — with its
 * own error message — rather than us refusing a bank we simply have not heard
 * of.
 */
export function bankCodeFor(provider: BankProvider, storedCode: string): string {
  const bank = findBank(storedCode);
  return bank ? bank.codes[provider] : storedCode;
}
