/**
 * Per-user WhatsApp conversation state — turns the stateless command bot into a
 * guided flow (vendor onboarding, buyer catalogue). In-memory with a TTL: fine
 * for a single instance since an active conversation keeps the app awake. Swap
 * for a Postgres-backed store if you scale to multiple instances.
 */
export interface ConvState {
  step: string;
  data: Record<string, unknown>;
  expiresAt: number;
}

export class ConversationStore {
  private map = new Map<string, ConvState>();
  constructor(private ttlMs = 60 * 60 * 1000) {}

  get(key: string): ConvState | null {
    const s = this.map.get(key);
    if (!s) return null;
    if (Date.now() > s.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return s;
  }

  set(key: string, step: string, data: Record<string, unknown>): void {
    this.map.set(key, { step, data, expiresAt: Date.now() + this.ttlMs });
  }

  clear(key: string): void {
    this.map.delete(key);
  }
}
