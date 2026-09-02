import type { Repositories } from "../../db/repositories.js";
import type { Clock } from "../../lib/clock.js";
import { hmacSign, hmacVerify } from "../../lib/crypto.js";
import { normalisePhone } from "../../lib/phone.js";
import { UnauthorizedError, ValidationError } from "../../lib/errors.js";
import { loadConfig } from "../../config/index.js";
import { randomInt } from "node:crypto";

interface Challenge {
  codeHash: string;
  expiresAt: Date;
  attempts: number;
}

/**
 * Merchant auth is phone-OTP (§2.2) — merchants live on mobile. OTP delivery
 * rides the same notification channels (WhatsApp/SMS). Sessions are stateless
 * HMAC-signed tokens so the API stays horizontally scalable.
 */
export class AuthService {
  private challenges = new Map<string, Challenge>();

  constructor(
    private repos: Repositories,
    private clock: Clock,
    private deliverOtp: (phone: string, code: string) => Promise<void>,
  ) {}

  async requestOtp(rawPhone: string): Promise<void> {
    const phone = normalisePhone(rawPhone) || rawPhone;
    if (!/^\+?\d{7,15}$/.test(phone)) throw new ValidationError("invalid phone");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.challenges.set(phone, {
      codeHash: hmacSign(code, this.secret()),
      expiresAt: new Date(this.clock.now().getTime() + 5 * 60_000),
      attempts: 0,
    });
    await this.deliverOtp(phone, code);
  }

  /** Verifies OTP; returns a signed session token bound to the merchant. */
  async verifyOtp(rawPhone: string, code: string): Promise<{ token: string; merchantId: string }> {
    // Normalise BOTH sides: the challenge was keyed on the normalised form, so
    // a user who types the number differently on the second screen must still
    // land on the same key.
    const phone = normalisePhone(rawPhone) || rawPhone;
    const challenge = this.challenges.get(phone);
    if (!challenge) throw new UnauthorizedError("no otp requested");
    if (this.clock.now() > challenge.expiresAt) {
      this.challenges.delete(phone);
      throw new UnauthorizedError("otp expired");
    }
    if (challenge.attempts >= 5) {
      this.challenges.delete(phone);
      throw new UnauthorizedError("too many attempts");
    }
    challenge.attempts++;
    if (!hmacVerify(code, challenge.codeHash, this.secret())) {
      throw new UnauthorizedError("invalid otp");
    }
    this.challenges.delete(phone);

    const merchant = await this.repos.merchants.byPhone(phone);
    if (!merchant) {
      // Deliberately NOT creating one. A blank shop conjured for an
      // unrecognised number is worse than a refusal: the person signs in, sees
      // zero sales, and concludes their business has vanished. Production
      // already carries orphaned "New Merchant" rows minted exactly this way.
      // Onboarding happens on WhatsApp, where the bot can actually ask for a
      // business name and a payout account.
      throw new UnauthorizedError(
        "no shop is registered on this number — message the WhatsApp bot to set one up",
      );
    }
    return { token: this.issueToken(merchant.id), merchantId: merchant.id };
  }

  verifyToken(token: string): string {
    const [merchantId, issuedAt, sig] = token.split(".");
    if (!merchantId || !issuedAt || !sig) throw new UnauthorizedError();
    if (!hmacVerify(`${merchantId}.${issuedAt}`, sig, this.secret())) {
      throw new UnauthorizedError("bad token");
    }
    return merchantId;
  }

  private issueToken(merchantId: string): string {
    const issuedAt = String(this.clock.now().getTime());
    const sig = hmacSign(`${merchantId}.${issuedAt}`, this.secret());
    return `${merchantId}.${issuedAt}.${sig}`;
  }

  private secret(): string {
    return loadConfig().APP_SECRET;
  }
}
