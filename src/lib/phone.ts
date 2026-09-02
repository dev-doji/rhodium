/**
 * Phone normalisation — one canonical form before anything is stored or
 * looked up.
 *
 * Nigerians write their number as 0803 680 3974. E.164 is +234 803 680 3974.
 * A sign-in form prefilled with "+234" plus a naturally-typed "0803…" produces
 * "+2340803…", which hashes to a DIFFERENT account — so a merchant signs in and
 * is handed an empty shop that was silently created for the typo. That is not
 * hypothetical: it happened, twice, and left orphaned "New Merchant" rows in
 * production.
 *
 * The trunk prefix `0` is a NATIONAL-dialling artefact. It is never part of the
 * international number, so `+234 0803…` is simply malformed and must collapse
 * onto `+234803…`.
 */

/** Default country calling code, digits only. Nigeria. */
const DEFAULT_CC = "234";

export function normalisePhone(input: string, countryCode = DEFAULT_CC): string {
  const raw = (input ?? "").trim();
  if (!raw) return "";

  // Keep a leading +, drop every other non-digit (spaces, dashes, brackets).
  const hadPlus = raw.startsWith("+");
  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  // 00 is the other way of writing +.
  if (!hadPlus && digits.startsWith("00")) digits = digits.slice(2);

  if (digits.startsWith(countryCode)) {
    // "+2340803…" — country code followed by the national trunk 0.
    const rest = digits.slice(countryCode.length);
    digits = countryCode + rest.replace(/^0+/, "");
  } else if (digits.startsWith("0")) {
    // Purely national form: 0803… -> 234803…
    digits = countryCode + digits.replace(/^0+/, "");
  }

  return `+${digits}`;
}
