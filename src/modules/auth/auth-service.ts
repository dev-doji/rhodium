import type { Repositories } from "../../db/repositories.js";
import type { Clock } from "../../lib/clock.js";
import { hmacSign, hmacVerify } from "../../lib/crypto.js";
import { ref } from "../../lib/ids.js";
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

  async requestOtp(phone: string): Promise<void> {
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
  async verifyOtp(phone: string, code: string): Promise<{ token: string; merchantId: string }> {
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

    let merchant = await this.repos.merchants.byPhone(phone);
    if (!merchant) {
      // First login = onboarding: create a pending merchant record.
      merchant = await this.repos.merchants.create({
        id: ref("mch"),
        phone,
        businessName: "New Merchant",
        status: "pending",
        kycState: "unverified",
        cryptoEnabled: false,
      });
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
