/**
 * Rendered receipts, kept so they are rendered once.
 *
 * A receipt is immutable: once an order is paid, its PNG and PDF can never
 * legitimately change. Rendering is the only CPU-bound work on a request path —
 * resvg takes 65-75ms per image, on Node's single thread — so while one renders,
 * nothing else is served. Measured: four concurrent renders took a trivial
 * health check from 1.3ms to 50ms.
 *
 * Bounded rather than unbounded. The service runs in 512MB, and an unbounded
 * cache of 44KB images is a slow memory leak that ends in a restart mid-payment.
 * At the default cap this holds about 9MB.
 *
 * Deliberately per-process. A second instance renders its own copy once, which
 * is a rounding error next to rendering on every request. Anything shared would
 * need the database on the hot path, which is what this exists to avoid.
 */

const DEFAULT_MAX_ENTRIES = 200;

export class ReceiptCache {
  /** Insertion-ordered, so the oldest key is simply the first. */
  private entries = new Map<string, Buffer>();

  constructor(private maxEntries = DEFAULT_MAX_ENTRIES) {}

  /**
   * Render once, then serve from memory.
   *
   * `render` is only called on a miss, and its result is stored under the key
   * given. Keys must include the FORMAT as well as the order — a PDF and a PNG
   * of the same receipt are different bytes.
   */
  get(key: string, render: () => Buffer): Buffer {
    const hit = this.entries.get(key);
    if (hit) {
      // Refresh recency: delete and re-insert moves it to the end, so the
      // eviction below always drops the least recently used.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }

    const rendered = render();
    this.entries.set(key, rendered);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return rendered;
  }

  /**
   * The same, for a renderer that returns a promise.
   *
   * Needed because awaiting the render before consulting the cache renders on
   * every request and caches the result nobody saved time on — which is exactly
   * what the first version of the PDF route did.
   */
  async getAsync(key: string, render: () => Promise<Buffer>): Promise<Buffer> {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    const rendered = await render();
    this.entries.set(key, rendered);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return rendered;
  }

  /** For tests and diagnostics. */
  get size(): number {
    return this.entries.size;
  }
}

/** One cache for the process. */
export const receiptCache = new ReceiptCache();
