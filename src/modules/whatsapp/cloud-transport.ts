import type { NotificationTransport, SendOptions } from "../notification/transport.js";
import { logger } from "../../lib/logger.js";

const log = logger("whatsapp-transport");

interface WhatsAppConfig {
  mode: "mock" | "live";
  accessToken: string;
  /** Platform number — the fallback sender when no tenant number is given. */
  phoneNumberId: string;
  graphBase?: string;
}

/**
 * WhatsApp Business Cloud API transport. Doubles as the primary notification
 * channel. In `mock` mode it captures outbound messages (no credentials); in
 * `live` mode it POSTs to the Graph API. Direct-vs-BSP is a config swap of
 * accessToken + phoneNumberId — no code change (§2.2 Phase 0 decision).
 *
 * Multi-tenant: `opts.phoneNumberId` picks WHICH number the message is sent
 * from, so a vendor's buyers are answered on the vendor's own number. The
 * access token stays global on purpose — under Independent Tech Provider
 * onboarding, our system-user token gains access to every WABA that Embedded
 * Signup shares with the app, so one token covers all tenants and we never
 * have to store a vendor's credentials.
 */
export class WhatsAppCloudTransport implements NotificationTransport {
  readonly channel = "whatsapp" as const;
  readonly outbox: { to: string; message: string; from: string }[] = [];
  private graphBase: string;

  constructor(private cfg: WhatsAppConfig) {
    this.graphBase = cfg.graphBase ?? "https://graph.facebook.com/v21.0";
  }

  async send(to: string, message: string, opts?: SendOptions): Promise<{ ok: boolean; ref?: string }> {
    const from = opts?.phoneNumberId || this.cfg.phoneNumberId;
    if (this.cfg.mode === "mock") {
      this.outbox.push({ to, message, from });
      return { ok: true, ref: `wa_mock_${this.outbox.length}` };
    }
    const res = await fetch(`${this.graphBase}/${from}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
      }),
    });
    if (!res.ok) {
      log.error({ status: res.status, from, text: await res.text() }, "whatsapp send failed");
      return { ok: false };
    }
    const body = (await res.json()) as { messages?: { id: string }[] };
    return { ok: true, ref: body.messages?.[0]?.id };
  }
}
