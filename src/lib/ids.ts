import { randomUUID, randomBytes } from "node:crypto";

/** Prefixed, sortable-ish ids for human-debuggable logs. */
export function id(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

/** Short opaque reference (e.g. provider payment refs, OTP challenge ids). */
export function ref(prefix: string, bytes = 8): string {
  return `${prefix}_${randomBytes(bytes).toString("hex")}`;
}
