import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemorySharedStore, PostgresSharedStore } from "../src/modules/state/shared-store.js";
import { prisma, disconnectPrisma } from "../src/db/prisma/client.js";

/**
 * Both implementations are tested with the same cases, because the point of the
 * memory one is to behave like the database one in tests. A divergence here is
 * a test suite that proves something about a class nothing uses in production.
 */
const implementations = [
  ["memory", () => new MemorySharedStore()],
  ["postgres", () => new PostgresSharedStore(prisma())],
] as const;

afterAll(async () => {
  await disconnectPrisma();
});

for (const [name, make] of implementations) {
  describe(`${name} shared store`, () => {
    const store = make();
    const k = (s: string) => `test:${name}:${s}:${Math.random().toString(36).slice(2)}`;

    it("counts hits in a window", async () => {
      const key = k("count");
      expect((await store.bump(key, 60_000)).count).toBe(1);
      expect((await store.bump(key, 60_000)).count).toBe(2);
      expect((await store.bump(key, 60_000)).count).toBe(3);
    });

    it("starts a fresh count once the window has passed", async () => {
      // Without this, a key that went quiet for an hour resumes at whatever it
      // reached last time and the next request is refused for no reason.
      const key = k("expiry");
      await store.bump(key, 1); // expires immediately
      await new Promise((r) => setTimeout(r, 20));
      expect((await store.bump(key, 60_000)).count).toBe(1);
    });

    it("counts each key separately", async () => {
      const a = k("a");
      const b = k("b");
      await store.bump(a, 60_000);
      await store.bump(a, 60_000);
      expect((await store.bump(b, 60_000)).count).toBe(1);
    });

    it("does not lose a hit when two land at once", async () => {
      // The reason this is in the database at all. Two instances counting the
      // same key must not both read 2 and both write 3.
      const key = k("race");
      const results = await Promise.all(
        Array.from({ length: 10 }, () => store.bump(key, 60_000)),
      );
      const counts = results.map((r) => r.count).sort((x, y) => x - y);
      expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it("stores and returns a value", async () => {
      const key = k("value");
      await store.put(key, { codeHash: "abc", attempts: 0 }, 60_000);
      expect(await store.get<{ codeHash: string }>(key)).toEqual({ codeHash: "abc", attempts: 0 });
    });

    it("treats an expired value as absent, even before it is swept", async () => {
      // An OTP must not outlive its own deadline just because the sweeper has
      // not run yet.
      const key = k("stale");
      await store.put(key, { codeHash: "abc" }, 1);
      await new Promise((r) => setTimeout(r, 20));
      expect(await store.get(key)).toBeNull();
    });

    it("drops a value on demand, so a one-time code is spent once", async () => {
      const key = k("drop");
      await store.put(key, { codeHash: "abc" }, 60_000);
      await store.drop(key);
      expect(await store.get(key)).toBeNull();
    });

    it("returns null for a key that was never set", async () => {
      expect(await store.get(k("missing"))).toBeNull();
    });

    it("sweeps expired rows", async () => {
      const key = k("sweep");
      await store.put(key, { x: 1 }, 1);
      await new Promise((r) => setTimeout(r, 20));
      await store.sweep();
      expect(await store.get(key)).toBeNull();
    });
  });
}
