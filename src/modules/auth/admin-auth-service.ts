import { randomInt, timingSafeEqual } from "node:crypto";
import type { Clock } from "../../lib/clock.js";
import { hmacSign, hmacVerify } from "../../lib/crypto.js";
import { UnauthorizedError, ValidationError } from "../../lib/errors.js";
import type { EmailSender } from "../email/email-sender.js";
import { MemorySharedStore, type SharedStore } from "../state/shared-store.js";

/** How long a code is good for. Long enough to switch to a mail app and back. */
const OTP_TTL_MS = 10 * 60_000;
/** Wrong guesses before the code is burned. */
const MAX_ATTEMPTS = 5;
/**
 * How long a signed-in admin session lasts.
 *
 * Merchant tokens (AuthService) carry no expiry at all. That is defensible for
 * a shop owner checking her own orders on her own phone; it is not defensible
 * for a surface that shows every merchant and every naira on the platform.
 */
const SESSION_TTL_MS = 12 * 60 * 60_000;

interface Challenge {
  codeHash: string;
  attempts: number;
}

export interface AdminAuthDeps {
  clock: Clock;
  email: EmailSender;
  /**
   * Shared, so a code issued by one instance is accepted by another. These were
   * held in a Map: with two instances an admin received a code from one and was
   * refused by the other.
   */
  store?: SharedStore;
  /** Raw ADMIN_EMAILS value — comma-separated. */
  adminEmails: string;
  secret: () => string;
}

/**
 * Sign-in for the Rhodium admin dashboard: email address, one-time code.
 *
 * Separate from AuthService on purpose. Merchants are phone-first because they
 * onboard on WhatsApp and have no email on file — the merchant table has no
 * email column. Admins are the opposite: a handful of known addresses, no
 * WhatsApp relationship, and a much higher blast radius if a session leaks.
 */
export class AdminAuthService {
  private readonly store: SharedStore;

  constructor(private deps: AdminAuthDeps) {
    this.store = deps.store ?? new MemorySharedStore();
  }

  private key(email: string): string {
    return `otp:admin:${email}`;
  }

  /** The configured allowlist, normalised. Empty means nobody can sign in. */
  get admins(): string[] {
    return this.deps.adminEmails
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  }

  isAdmin(email: string): boolean {
    const normalised = normaliseEmail(email);
    // Compared in constant time so response timing cannot be used to discover
    // who the admins are, one character at a time.
    return this.admins.some((allowed) => constantTimeEquals(allowed, normalised));
  }

  /**
   * Send a code, if the address is an admin.
   *
   * Resolves either way, and says nothing about whether the address was
   * recognised. A signed-out stranger who can ask "is this address an admin?"
   * has been handed the first half of the problem.
   */
  async requestOtp(rawEmail: string): Promise<void> {
    const email = normaliseEmail(rawEmail);
    if (!isEmailShaped(email)) throw new ValidationError("invalid email address");
    if (!this.isAdmin(email)) return;

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.store.put(
      this.key(email),
      { codeHash: hmacSign(code, this.deps.secret()), attempts: 0 },
      OTP_TTL_MS,
    );

    await this.deps.email.send({
      to: email,
      subject: `${code} is your Rhodium admin code`,
      text:
        `${code} is your sign-in code for the Rhodium admin dashboard.\n\n` +
        `It expires in ${OTP_TTL_MS / 60_000} minutes.\n\n` +
        `If you did not ask to sign in, ignore this email and tell no one the code.`,
    });
  }

  /** Verifies the code and returns a session token. */
  async verifyOtp(rawEmail: string, code: string): Promise<{ token: string; email: string }> {
    const email = normaliseEmail(rawEmail);
    const key = this.key(email);
    // Expiry is enforced by the store, which treats an expired row as absent.
    const challenge = await this.store.get<Challenge>(key);
    // One message for every failure below, so a wrong code and an address that
    // was never sent one are indistinguishable from outside.
    const reject = (): never => {
      throw new UnauthorizedError("that code is not valid");
    };

    if (!challenge) reject();
    if (challenge!.attempts >= MAX_ATTEMPTS) {
      await this.store.drop(key);
      reject();
    }
    if (!hmacVerify(code, challenge!.codeHash, this.deps.secret())) {
      // The attempt must be written back before refusing, or a wrong guess
      // costs nothing and the cap of five never arrives.
      await this.store.put(key, { ...challenge!, attempts: challenge!.attempts + 1 }, OTP_TTL_MS);
      reject();
    }

    // Burned on success as well as failure: a code is good exactly once.
    await this.store.drop(key);
    // Re-checked at the moment of issue, not just at request: an address
    // removed from the allowlist between the two must not get a session.
    if (!this.isAdmin(email)) reject();

    return { token: this.issueToken(email), email };
  }

  /** Returns the admin's email, or throws. */
  verifyToken(token: string): string {
    const parts = token.split(".");
    if (parts.length !== 3) throw new UnauthorizedError("bad admin token");
    const [subject, issuedAt, sig] = parts as [string, string, string];

    // The signed payload is namespaced, so a merchant session token can never
    // be replayed here and an admin token can never pass as a merchant's.
    if (!hmacVerify(`${TOKEN_AUDIENCE}:${subject}.${issuedAt}`, sig, this.deps.secret())) {
      throw new UnauthorizedError("bad admin token");
    }

    const age = this.deps.clock.now().getTime() - Number(issuedAt);
    if (!Number.isFinite(age) || age < 0 || age > SESSION_TTL_MS) {
      throw new UnauthorizedError("session expired, sign in again");
    }

    const email = Buffer.from(subject, "base64url").toString("utf8");
    // Revocation is simply removing the address from ADMIN_EMAILS: checked on
    // every request rather than trusted from the token.
    if (!this.isAdmin(email)) throw new UnauthorizedError("no longer an admin");
    return email;
  }

  private issueToken(email: string): string {
    const issuedAt = String(this.deps.clock.now().getTime());
    // base64url, NOT encodeURIComponent: the token is split on ".", and every
    // email domain contains one. Percent-encoding leaves the dots in place and
    // the token parses into four parts, so no session ever verifies.
    const subject = Buffer.from(email, "utf8").toString("base64url");
    const sig = hmacSign(`${TOKEN_AUDIENCE}:${subject}.${issuedAt}`, this.deps.secret());
    return `${subject}.${issuedAt}.${sig}`;
  }
}

const TOKEN_AUDIENCE = "admin";

function normaliseEmail(email: string): string {
  return String(email ?? "").trim().toLowerCase();
}

/**
 * Shape check only. Deliberately not an RFC 5322 regex: the address either
 * matches the allowlist or it does not, and that is the check that matters.
 */
function isEmailShaped(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/**
 * Constant-time compare for equal-length inputs. Differing lengths return
 * early — that leaks length, which is not a secret here; the address is.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
