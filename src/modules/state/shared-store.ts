import type { PrismaClient } from "@prisma/client";

/**
 * State every instance must agree about.
 *
 * Rate-limit windows and one-time sign-in codes lived in JavaScript Maps inside
 * a single process. That is correct for exactly one instance and wrong for two:
 *
 *   - A buyer who requests an OTP from one instance and submits it to another is
 *     told the code is invalid, because the other instance never saw it.
 *   - Every rate limit becomes per-instance, so the cap of 3 OTPs per 15 minutes
 *     silently becomes 3 x the number of instances — on the endpoint that sends
 *     a real WhatsApp message to whatever number is in the request body.
 *
 * Both are the reason the platform cannot currently be scaled out, so both move
 * here before anything else about scaling is worth doing.
 */
export interface SharedStore {
  /**
   * Count one hit against a fixed window, atomically.
   *
   * Returns the count AFTER this hit and when the window resets. Atomicity is
   * the whole point: two instances counting the same key at the same moment
   * must not both read 2 and both write 3.
   */
  bump(key: string, windowMs: number): Promise<{ count: number; resetAt: Date }>;

  /** Store a small value under a key until `ttlMs` has passed. */
  put(key: string, value: unknown, ttlMs: number): Promise<void>;

  /** Read it back, or null if absent or expired. */
  get<T>(key: string): Promise<T | null>;

  /** Remove it. Used to burn a one-time code the moment it is spent. */
  drop(key: string): Promise<void>;

  /** Delete everything already expired. Cheap, indexed, and safe to call often. */
  sweep(): Promise<number>;
}

/**
 * Postgres-backed, for production and anywhere with a database.
 *
 * One table, because these are all "a small value under a key, that expires",
 * and three near-identical tables would need three near-identical sweepers.
 */
export class PostgresSharedStore implements SharedStore {
  constructor(private db: PrismaClient) {}

  async bump(key: string, windowMs: number): Promise<{ count: number; resetAt: Date }> {
    const resetAt = new Date(Date.now() + windowMs);
    // A single statement, so the read-modify-write cannot interleave with
    // another instance's. The CASE handles an expired window by starting a new
    // one rather than continuing an old count — without it, a key that went
    // quiet for an hour would resume at whatever it reached last time.
    const rows = await this.db.$queryRaw<{ count: number; expires_at: Date }[]>`
      INSERT INTO ephemeral_state (key, value, expires_at)
      VALUES (${key}, '1', ${resetAt})
      ON CONFLICT (key) DO UPDATE SET
        value = CASE
          WHEN ephemeral_state.expires_at <= now() THEN '1'
          ELSE ((ephemeral_state.value)::int + 1)::text
        END,
        expires_at = CASE
          WHEN ephemeral_state.expires_at <= now() THEN ${resetAt}
          ELSE ephemeral_state.expires_at
        END
      RETURNING (value)::int AS count, expires_at
    `;
    const row = rows[0];
    return row
      ? { count: Number(row.count), resetAt: row.expires_at }
      : { count: 1, resetAt };
  }

  async put(key: string, value: unknown, ttlMs: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlMs);
    const serialised = JSON.stringify(value);
    await this.db.ephemeralState.upsert({
      where: { key },
      create: { key, value: serialised, expiresAt },
      update: { value: serialised, expiresAt },
    });
  }

  async get<T>(key: string): Promise<T | null> {
    const row = await this.db.ephemeralState.findUnique({ where: { key } });
    if (!row) return null;
    // Expiry is checked on read as well as swept in the background: a row the
    // sweeper has not reached yet must never be treated as live, or an OTP
    // outlives its own deadline.
    if (row.expiresAt.getTime() <= Date.now()) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  async drop(key: string): Promise<void> {
    await this.db.ephemeralState.deleteMany({ where: { key } });
  }

  async sweep(): Promise<number> {
    const { count } = await this.db.ephemeralState.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    return count;
  }
}

/**
 * In-process, for tests and for running without a database.
 *
 * Behaviour matches the Postgres one exactly, including expiry-on-read, so a
 * test proves something about production rather than about this class.
 */
export class MemorySharedStore implements SharedStore {
  private rows = new Map<string, { value: string; expiresAt: number }>();

  async bump(key: string, windowMs: number): Promise<{ count: number; resetAt: Date }> {
    const now = Date.now();
    const existing = this.rows.get(key);
    if (!existing || existing.expiresAt <= now) {
      const resetAt = now + windowMs;
      this.rows.set(key, { value: "1", expiresAt: resetAt });
      return { count: 1, resetAt: new Date(resetAt) };
    }
    const count = Number(existing.value) + 1;
    existing.value = String(count);
    return { count, resetAt: new Date(existing.expiresAt) };
  }

  async put(key: string, value: unknown, ttlMs: number): Promise<void> {
    this.rows.set(key, { value: JSON.stringify(value), expiresAt: Date.now() + ttlMs });
  }

  async get<T>(key: string): Promise<T | null> {
    const row = this.rows.get(key);
    if (!row) return null;
    if (row.expiresAt <= Date.now()) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  async drop(key: string): Promise<void> {
    this.rows.delete(key);
  }

  async sweep(): Promise<number> {
    const now = Date.now();
    let removed = 0;
    for (const [key, row] of this.rows) {
      if (row.expiresAt <= now) {
        this.rows.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
