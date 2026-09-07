import { describe, it, expect } from "vitest";
import { AdminAuthService } from "../src/modules/auth/admin-auth-service.js";
import { MockEmailSender } from "../src/modules/email/email-sender.js";
import { FixedClock } from "../src/lib/clock.js";

/**
 * This guards the screen that shows every merchant and every naira on the
 * platform. The cases below are the ways in, not the happy path restated.
 */
const SECRET = "test-secret-not-the-real-one";

function make(adminEmails = "owner@fonio.ng, Second.Admin@Fonio.NG") {
  const clock = new FixedClock(new Date("2026-09-07T12:00:00Z"));
  const email = new MockEmailSender();
  const auth = new AdminAuthService({
    clock,
    email,
    adminEmails,
    secret: () => SECRET,
  });
  return { auth, email, clock };
}

/** Pull the code out of the mock inbox the way a person reads their email. */
function codeFrom(email: MockEmailSender): string {
  const last = email.sent.at(-1);
  if (!last) throw new Error("no email was sent");
  const m = last.text.match(/\b(\d{6})\b/);
  if (!m) throw new Error(`no 6-digit code in: ${last.text}`);
  return m[1]!;
}

describe("who is allowed in", () => {
  it("sends a code to an address on the allowlist", async () => {
    const { auth, email } = make();
    await auth.requestOtp("owner@fonio.ng");
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toBe("owner@fonio.ng");
  });

  it("matches regardless of case or surrounding spaces", async () => {
    const { auth, email } = make();
    await auth.requestOtp("  SECOND.ADMIN@fonio.ng  ");
    expect(email.sent).toHaveLength(1);
  });

  it("sends nothing to an address that is not an admin", async () => {
    const { auth, email } = make();
    await auth.requestOtp("stranger@example.com");
    expect(email.sent).toHaveLength(0);
  });

  it("does not reveal whether an address is an admin", async () => {
    // Both resolve, identically. If the unknown address threw, or returned
    // anything different, this endpoint would be a way to discover who can
    // sign in — the first half of the attacker's problem, handed over.
    const { auth } = make();
    await expect(auth.requestOtp("owner@fonio.ng")).resolves.toBeUndefined();
    await expect(auth.requestOtp("stranger@example.com")).resolves.toBeUndefined();
  });

  it("lets nobody in when the allowlist is empty", async () => {
    // The default. An admin surface that opens because a variable was
    // forgotten is worse than one that is unreachable until configured.
    const { auth, email } = make("");
    expect(auth.admins).toEqual([]);
    await auth.requestOtp("owner@fonio.ng");
    expect(email.sent).toHaveLength(0);
  });

  it("rejects something that is not an email address at all", async () => {
    const { auth } = make();
    await expect(auth.requestOtp("not-an-email")).rejects.toThrow(/invalid email/i);
  });
});

describe("the code itself", () => {
  it("exchanges a correct code for a session", async () => {
    const { auth, email } = make();
    await auth.requestOtp("owner@fonio.ng");
    const { token, email: who } = await auth.verifyOtp("owner@fonio.ng", codeFrom(email));
    expect(who).toBe("owner@fonio.ng");
    expect(auth.verifyToken(token)).toBe("owner@fonio.ng");
  });

  it("works exactly once", async () => {
    const { auth, email } = make();
    await auth.requestOtp("owner@fonio.ng");
    const code = codeFrom(email);
    await auth.verifyOtp("owner@fonio.ng", code);
    await expect(auth.verifyOtp("owner@fonio.ng", code)).rejects.toThrow();
  });

  it("expires", async () => {
    const { auth, email, clock } = make();
    await auth.requestOtp("owner@fonio.ng");
    const code = codeFrom(email);
    clock.advance(11 * 60_000);
    await expect(auth.verifyOtp("owner@fonio.ng", code)).rejects.toThrow();
  });

  it("is burned after five wrong guesses", async () => {
    const { auth, email } = make();
    await auth.requestOtp("owner@fonio.ng");
    const real = codeFrom(email);
    const wrong = real === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      await expect(auth.verifyOtp("owner@fonio.ng", wrong)).rejects.toThrow();
    }
    // Even the correct code no longer works — the challenge is gone.
    await expect(auth.verifyOtp("owner@fonio.ng", real)).rejects.toThrow();
  });

  it("says the same thing for a wrong code and an address never sent one", async () => {
    // Different messages here would tell an attacker which addresses are
    // admins by the shape of the refusal.
    const { auth, email } = make();
    await auth.requestOtp("owner@fonio.ng");
    const wrong = codeFrom(email) === "000000" ? "111111" : "000000";

    const a = await auth.verifyOtp("owner@fonio.ng", wrong).catch((e) => (e as Error).message);
    const b = await auth.verifyOtp("stranger@example.com", "123456").catch((e) => (e as Error).message);
    expect(a).toBe(b);
  });
});

describe("the session token", () => {
  async function signedIn() {
    const ctx = make();
    await ctx.auth.requestOtp("owner@fonio.ng");
    const { token } = await ctx.auth.verifyOtp("owner@fonio.ng", codeFrom(ctx.email));
    return { ...ctx, token };
  }

  it("expires after 12 hours", async () => {
    const { auth, clock, token } = await signedIn();
    clock.advance(11 * 60 * 60_000);
    expect(auth.verifyToken(token)).toBe("owner@fonio.ng");
    clock.advance(2 * 60 * 60_000);
    expect(() => auth.verifyToken(token)).toThrow(/expired/i);
  });

  it("stops working the moment the address leaves the allowlist", async () => {
    // Revocation has to be possible without waiting 12 hours for expiry, and
    // without a session store to purge. The allowlist is re-read per request.
    const clock = new FixedClock(new Date("2026-09-07T12:00:00Z"));
    const email = new MockEmailSender();
    let allowlist = "owner@fonio.ng";
    const auth = new AdminAuthService({
      clock,
      email,
      get adminEmails() {
        return allowlist;
      },
      secret: () => SECRET,
    });

    await auth.requestOtp("owner@fonio.ng");
    const { token } = await auth.verifyOtp("owner@fonio.ng", codeFrom(email));
    expect(auth.verifyToken(token)).toBe("owner@fonio.ng");

    allowlist = "";
    expect(() => auth.verifyToken(token)).toThrow();
  });

  it("refuses a token signed with a different secret", async () => {
    const { token } = await signedIn();
    const other = new AdminAuthService({
      clock: new FixedClock(new Date("2026-09-07T12:00:00Z")),
      email: new MockEmailSender(),
      adminEmails: "owner@fonio.ng",
      secret: () => "a-different-secret",
    });
    expect(() => other.verifyToken(token)).toThrow();
  });

  it("refuses a tampered subject", async () => {
    const { auth, token } = await signedIn();
    const [, issuedAt, sig] = token.split(".");
    const forged = `${Buffer.from("attacker@example.com").toString("base64url")}.${issuedAt}.${sig}`;
    expect(() => auth.verifyToken(forged)).toThrow();
  });

  it("does not accept a merchant token", async () => {
    // Merchant tokens are signed with the same APP_SECRET and have the same
    // three-part shape. Only the namespaced payload stops one being replayed
    // as the other — worth a test, because the failure would be silent and
    // would hand a shop owner the whole platform.
    const { auth } = make();
    const { AuthService } = await import("../src/modules/auth/auth-service.js");
    expect(AuthService).toBeTypeOf("function");

    const { hmacSign } = await import("../src/lib/crypto.js");
    const issuedAt = String(Date.now());
    const merchantId = "mch_123";
    const merchantToken = `${merchantId}.${issuedAt}.${hmacSign(`${merchantId}.${issuedAt}`, SECRET)}`;

    expect(() => auth.verifyToken(merchantToken)).toThrow();
  });

  it("is not usable as a merchant token either", async () => {
    const { hmacVerify } = await import("../src/lib/crypto.js");
    const { token } = await signedIn();
    const [subject, issuedAt, sig] = token.split(".");
    // This is precisely what AuthService.verifyToken checks.
    expect(hmacVerify(`${subject}.${issuedAt}`, sig!, SECRET)).toBe(false);
  });

  it("refuses tokens that are not three parts", async () => {
    const { auth } = make();
    for (const bad of ["", "a", "a.b", "a.b.c.d"]) {
      expect(() => auth.verifyToken(bad)).toThrow();
    }
  });
});
