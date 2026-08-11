import { describe, it, expect } from "vitest";
import { canTransition, assertTransition } from "../src/domain/order-state.js";
import { nairaToKobo, formatNaira, assertKobo } from "../src/lib/money.js";
import { encryptField, decryptField, hmacVerify, hmacSign } from "../src/lib/crypto.js";
import { StablecoinRail } from "../src/rails/stablecoin-rail.js";
import { EventBus } from "../src/events/bus.js";
import { InMemoryIdempotencyStore } from "../src/events/idempotency.js";
import { FeatureDisabledError } from "../src/lib/errors.js";
import { resetConfigCache } from "../src/config/index.js";

describe("order state machine", () => {
  it("allows only legal transitions", () => {
    expect(canTransition("draft", "awaiting_payment")).toBe(true);
    expect(canTransition("awaiting_payment", "paid")).toBe(true);
    expect(canTransition("paid", "fulfilled")).toBe(true);
    expect(canTransition("draft", "paid")).toBe(false);
    expect(canTransition("paid", "awaiting_payment")).toBe(false);
    expect(canTransition("fulfilled", "cancelled")).toBe(false);
  });
  it("throws on an illegal transition", () => {
    expect(() => assertTransition("expired", "paid")).toThrow(/illegal/);
  });
});

describe("money (kobo, integer-only)", () => {
  it("converts and formats", () => {
    expect(nairaToKobo(5000)).toBe(500_000);
    expect(formatNaira(500_000)).toBe("₦5,000.00");
  });
  it("rejects non-integer / negative kobo", () => {
    expect(() => assertKobo(1.5)).toThrow();
    expect(() => assertKobo(-1)).toThrow();
  });
});

describe("field crypto (NDPR-aware at rest)", () => {
  it("round-trips encrypted PII", () => {
    resetConfigCache();
    process.env.FIELD_ENCRYPTION_KEY = "a".repeat(64);
    const secret = encryptField("+2348030000001");
    expect(secret).not.toContain("+234");
    expect(decryptField(secret)).toBe("+2348030000001");
  });
  it("verifies HMAC signatures in constant time", () => {
    const sig = hmacSign("payload", "k");
    expect(hmacVerify("payload", sig, "k")).toBe(true);
    expect(hmacVerify("payload", sig, "wrong")).toBe(false);
  });
});

describe("stablecoin rail is built but DARK", () => {
  it("refuses every operation while the flag is off", async () => {
    const rail = new StablecoinRail(false);
    await expect(
      rail.createPaymentInstruction({} as never, {} as never),
    ).rejects.toBeInstanceOf(FeatureDisabledError);
    await expect(rail.verifyPayment("x")).rejects.toBeInstanceOf(FeatureDisabledError);
  });
});

describe("event bus idempotency", () => {
  it("drops a duplicate event key", async () => {
    const bus = new EventBus(new InMemoryIdempotencyStore());
    let count = 0;
    bus.on("payment.failed", async () => {
      count++;
    });
    const evt = {
      name: "payment.failed" as const,
      orderId: "o1",
      paymentId: "p1",
      reason: "x",
      occurredAt: new Date().toISOString(),
    };
    await bus.publish("key-1", evt);
    await bus.publish("key-1", evt); // duplicate
    expect(count).toBe(1);
  });

  it("dead-letters a handler that exhausts retries", async () => {
    const bus = new EventBus(new InMemoryIdempotencyStore(), { maxAttempts: 2 });
    bus.on("payment.failed", async () => {
      throw new Error("boom");
    });
    await bus.publish("key-2", {
      name: "payment.failed",
      orderId: "o",
      paymentId: "p",
      reason: "x",
      occurredAt: new Date().toISOString(),
    });
    expect(bus.deadLetters).toHaveLength(1);
  });
});
