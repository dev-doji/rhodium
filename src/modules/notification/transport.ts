/**
 * Which sender a message goes out from. On WhatsApp this is the Cloud API
 * `phone_number_id` of the vendor's own number — the tenant the buyer is
 * actually talking to. Omitted => the platform's own number.
 *
 * This matters beyond cosmetics: the 24-hour customer-service window that lets
 * us send free-form text is per *number*. A buyer who messaged the vendor's
 * number has opened a window there and nowhere else, so a receipt sent from
 * Rhodium's number would simply be rejected by Meta.
 */
export interface SendOptions {
  phoneNumberId?: string;
}

/** A channel that can deliver a message to a recipient. */
export interface NotificationTransport {
  readonly channel: "whatsapp" | "sms" | "email";
  send(to: string, message: string, opts?: SendOptions): Promise<{ ok: boolean; ref?: string }>;
  /**
   * Deliver an image by public URL, with the text as its caption.
   *
   * Optional: SMS and email have no equivalent, and a channel without it simply
   * falls back to sending the caption as text — a receipt must never go missing
   * because a picture could not be attached.
   */
  sendImage?(
    to: string,
    imageUrl: string,
    caption: string,
    opts?: SendOptions,
  ): Promise<{ ok: boolean; ref?: string }>;
}

/** Test/demo double — captures everything sent, never leaves the process. */
export class CaptureTransport implements NotificationTransport {
  readonly sent: { to: string; message: string; from?: string; imageUrl?: string }[] = [];
  constructor(readonly channel: "whatsapp" | "sms" | "email" = "whatsapp") {}
  async send(
    to: string,
    message: string,
    opts?: SendOptions,
  ): Promise<{ ok: boolean; ref?: string }> {
    this.sent.push({ to, message, from: opts?.phoneNumberId });
    return { ok: true, ref: `capture_${this.sent.length}` };
  }

  async sendImage(
    to: string,
    imageUrl: string,
    caption: string,
    opts?: SendOptions,
  ): Promise<{ ok: boolean; ref?: string }> {
    this.sent.push({ to, message: caption, from: opts?.phoneNumberId, imageUrl });
    return { ok: true, ref: `capture_img_${this.sent.length}` };
  }
}
