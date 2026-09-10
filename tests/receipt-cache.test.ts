import { describe, it, expect } from "vitest";
import { ReceiptCache } from "../src/modules/receipt/receipt-cache.js";

/**
 * The only CPU-bound work on a request path. Node has one thread, so a receipt
 * rendering is a receipt everyone else waits behind — measured at 65-75ms each,
 * and four at once took a health check from 1.3ms to 50ms.
 */
describe("rendered receipts are rendered once", () => {
  it("does not call the renderer twice for the same receipt", () => {
    const cache = new ReceiptCache();
    let renders = 0;
    const render = () => {
      renders++;
      return Buffer.from("receipt bytes");
    };

    const first = cache.get("png:ABC123", render);
    const second = cache.get("png:ABC123", render);

    expect(renders).toBe(1);
    expect(second).toBe(first);
  });

  it("keeps formats apart", () => {
    // A PDF and a PNG of the same order are different bytes. Keying on the
    // order alone would serve one as the other.
    const cache = new ReceiptCache();
    const png = cache.get("png:ABC123", () => Buffer.from("png"));
    const pdf = cache.get("pdf:ABC123", () => Buffer.from("pdf"));
    expect(png.toString()).toBe("png");
    expect(pdf.toString()).toBe("pdf");
  });

  it("stays bounded, so it cannot eat a 512MB instance", () => {
    // An unbounded cache of 44KB images is a slow leak that ends in a restart
    // mid-payment.
    const cache = new ReceiptCache(3);
    for (const id of ["a", "b", "c", "d", "e"]) {
      cache.get(`png:${id}`, () => Buffer.from(id));
    }
    expect(cache.size).toBe(3);
  });

  it("evicts the least recently USED, not the oldest inserted", () => {
    const cache = new ReceiptCache(2);
    cache.get("png:a", () => Buffer.from("a"));
    cache.get("png:b", () => Buffer.from("b"));
    cache.get("png:a", () => Buffer.from("SHOULD NOT RENDER")); // refreshes a
    cache.get("png:c", () => Buffer.from("c")); // should evict b, not a

    let reRendered = false;
    cache.get("png:a", () => {
      reRendered = true;
      return Buffer.from("a again");
    });
    expect(reRendered).toBe(false);
  });

  it("awaits an async renderer only on a miss", async () => {
    // The first version of the PDF route awaited the render BEFORE consulting
    // the cache, so it rendered every time and cached a result nobody saved
    // time on.
    const cache = new ReceiptCache();
    let renders = 0;
    const render = async () => {
      renders++;
      return Buffer.from("pdf bytes");
    };

    await cache.getAsync("pdf:ABC123", render);
    await cache.getAsync("pdf:ABC123", render);
    expect(renders).toBe(1);
  });
});
