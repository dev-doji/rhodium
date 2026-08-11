/**
 * Idempotency store. A processed key is remembered so a replayed webhook /
 * event never produces a second side effect (no double ledger entry).
 *
 * The interface is what matters; back it with Postgres in prod (a unique
 * constraint on the key) and in-memory in tests.
 */
export interface IdempotencyStore {
  /** Returns true if this key was newly reserved (first time), false if seen. */
  reserve(key: string): Promise<boolean>;
  seen(key: string): Promise<boolean>;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private keys = new Set<string>();

  async reserve(key: string): Promise<boolean> {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    return true;
  }

  async seen(key: string): Promise<boolean> {
    return this.keys.has(key);
  }
}
