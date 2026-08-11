/**
 * Field-level encryption for PII / financial data at rest (NDPR-aware),
 * and HMAC helpers for webhook-signature verification + OTP challenges.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { loadConfig } from "../config/index.js";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  const hex = loadConfig().FIELD_ENCRYPTION_KEY;
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    throw new Error("FIELD_ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  }
  return buf;
}

/** Returns compact `iv.tag.ciphertext` base64 triples. */
export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64")).join(".");
}

export function decryptField(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("malformed ciphertext");
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function hmacSign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Constant-time comparison of a provided signature against the expected one. */
export function hmacVerify(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = hmacSign(payload, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
