/** A channel that can deliver a message to a recipient. */
export interface NotificationTransport {
  readonly channel: "whatsapp" | "sms" | "email";
  send(to: string, message: string): Promise<{ ok: boolean; ref?: string }>;
}

/** Test/demo double — captures everything sent, never leaves the process. */
export class CaptureTransport implements NotificationTransport {
  readonly sent: { to: string; message: string }[] = [];
  constructor(readonly channel: "whatsapp" | "sms" | "email" = "whatsapp") {}
  async send(to: string, message: string): Promise<{ ok: boolean; ref?: string }> {
    this.sent.push({ to, message });
    return { ok: true, ref: `capture_${this.sent.length}` };
  }
}
