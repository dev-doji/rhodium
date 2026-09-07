import { logger } from "../../lib/logger.js";
import { AppError } from "../../lib/errors.js";

const log = logger("email");

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text. Always sent — some clients never render the HTML part. */
  text: string;
  html?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Development sender: writes the message to the log instead of sending it.
 *
 * The OTP is logged deliberately, so the admin sign-in flow is exercisable end
 * to end with no credentials and no real mailbox. That is also exactly why it
 * must never run in production — `EMAIL_MODE=live` is enforced at boot when
 * NODE_ENV is production, in src/config/index.ts.
 */
export class MockEmailSender implements EmailSender {
  /** Kept for assertions in tests. */
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    log.info({ to: message.to, subject: message.subject, text: message.text }, "email (mock)");
  }
}

/**
 * Resend, over their HTTP API.
 *
 * Deliberately not the `resend` npm package: this is one POST with a bearer
 * token, and a dependency for that is a dependency to keep patched. Swapping
 * providers means writing another EmailSender, not touching the auth code.
 */
export class ResendEmailSender implements EmailSender {
  constructor(
    private apiKey: string,
    private from: string,
    private baseUrl = "https://api.resend.com",
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await fetch(`${this.baseUrl}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    });

    if (!res.ok) {
      // Carry Resend's own message: "domain is not verified" and "invalid api
      // key" are different problems with different fixes, and a generic
      // "email failed" sends you to the wrong one.
      const detail = await res.text().catch(() => "");
      log.error({ status: res.status, detail, to: message.to }, "resend api error");
      throw new AppError(
        `could not send email (resend ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""})`,
        "provider_error",
        502,
      );
    }
  }
}
