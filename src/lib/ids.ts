import { randomUUID, randomBytes } from "node:crypto";

/** Prefixed, sortable-ish ids for human-debuggable logs. */
export function id(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

/** Short opaque reference (e.g. provider payment refs, OTP challenge ids). */
export function ref(prefix: string, bytes = 8): string {
  return `${prefix}_${randomBytes(bytes).toString("hex")}`;
}

/**
 * Turn a business name into a WhatsApp-friendly shop handle: "Circuit City" →
 * "circuitcity". Punctuation and spaces are dropped rather than hyphenated,
 * because the handle is spoken aloud and retyped ("shop-circuitcity"), and a
 * hyphen inside it reads as a break in the deep-link prefix.
 */
export function slugify(businessName: string): string {
  return businessName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
}
