import { hmacSign } from "./crypto.js";
import { loadConfig } from "../config/index.js";

/**
 * Deterministic, non-reversible hash for encrypted-PII lookup columns.
 * We store PII encrypted (reversible, for display) AND a blind hash (for
 * equality lookups like "find merchant by phone") so we never query on
 * plaintext PII.
 */
export function blindIndex(value: string): string {
  return hmacSign(value.trim().toLowerCase(), loadConfig().APP_SECRET);
}
