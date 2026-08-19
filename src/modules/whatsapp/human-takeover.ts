/**
 * Human takeover — the bot's "step aside" switch for WhatsApp Coexistence.
 *
 * Under coexistence a vendor's number is live on BOTH the WhatsApp Business app
 * and the Cloud API at once, so the vendor is answering customers by hand in the
 * app while this bot auto-replies to the same inbound messages. Left alone that
 * produces two answers to every "hi" — the catalogue from us, a greeting from
 * her — which reads as a shop that can't get its story straight.
 *
 * Meta tells us when she replies by hand via the `smb_message_echoes` webhook.
 * On each echo we mark that one thread as hers and the bot stays quiet there
 * until the window lapses. Other buyers on the same number are unaffected: this
 * is per conversation, not per number, because a vendor handling one order
 * personally still wants the other twenty served automatically.
 *
 * The window is deliberately short. Failing back to an automated shop after a
 * lull is recoverable; a bot that goes permanently silent because she once typed
 * "thanks" is not.
 */
export class HumanTakeoverStore {
  private until = new Map<string, number>();

  constructor(private ttlMs = 30 * 60 * 1000) {}

  /** The vendor just answered this thread by hand — back off. */
  note(key: string): void {
    this.until.set(key, Date.now() + this.ttlMs);
  }

  /** Is a human currently handling this thread? */
  active(key: string): boolean {
    const expires = this.until.get(key);
    if (expires == null) return false;
    if (Date.now() > expires) {
      this.until.delete(key);
      return false;
    }
    return true;
  }

  /** Hand the thread back to the bot (used by tests and explicit resets). */
  clear(key: string): void {
    this.until.delete(key);
  }
}
