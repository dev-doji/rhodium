import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig, resetConfigCache } from "../src/config/index.js";
import { CaptureTransport } from "../src/modules/notification/transport.js";
import { createPrismaRepositories } from "../src/db/prisma/prisma-repositories.js";
import { PrismaIdempotencyStore } from "../src/db/prisma/prisma-idempotency.js";
import { prisma, disconnectPrisma } from "../src/db/prisma/client.js";
import { MonnifyFiatRail } from "../src/rails/monnify-fiat-rail.js";
import { ref } from "../src/lib/ids.js";

/**
 * Real-Postgres integration. Runs ONLY when DATABASE_URL is set (CI + local
 * `npm run db:up`). Proves the exact same magic-moment loop — including the
 * SERIALIZABLE atomic ledger append and the DB-backed idempotency store — works
 * against a live database, not just the in-memory doubles.
 */
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("magic moment against live Postgres", () => {
  let app: ReturnType<typeof buildApp>;
  let merchantId: string;

  beforeAll(async () => {
    resetConfigCache();
    process.env.FIAT_ADAPTER_MODE = "mock";
    process.env.WHATSAPP_MODE = "mock";
    const db = prisma();
    const config = loadConfig();
    app = buildApp({
      config,
      repos: createPrismaRepositories(db),
      idempotency: new PrismaIdempotencyStore(db),
      notificationChannels: [new CaptureTransport("whatsapp")],
    });
    const merchant = await app.repos.merchants.create({
      id: ref("mch"),
      phone: `+23480${Date.now().toString().slice(-8)}`,
      businessName: "PG Store",
      status: "active",
      kycState: "verified",
      cryptoEnabled: false,
      settlementBankCode: "058",
      settlementAccountNumber: "0123456789",
    });
    merchantId = merchant.id;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("persists the full loop and is idempotent on replay", async () => {
    const product = await app.commerce.createProduct({
      merchantId,
      name: "PG Lipstick",
      price: 500_000,
      stockQty: 5,
    });
    const order = await app.commerce.createOrder({
      merchantId,
      buyerRef: "+2348090003333",
      lines: [{ productId: product.id, qty: 2 }],
    });
    const instruction = await app.payments.requestPayment(order.id);
    expect(instruction.accountNumber).toMatch(/^\d{10}$/);

    const payment = await app.repos.payments.byProviderRef(instruction.providerRef);
    const fiat = app.rails.fiat() as MonnifyFiatRail;

    const before = await app.ledger.balance(merchantId);
    const signed = fiat.mock!.simulateTransfer(payment!.providerRef);
    await app.payments.handleRailWebhook("monnify", {
      headers: { "monnify-signature": signed.signature },
      rawBody: signed.rawBody,
    });

    // Replay the identical webhook — DB-backed idempotency must dedupe it.
    const replay = fiat.mock!.replayLastTransfer(payment!.providerRef);
    await app.payments.handleRailWebhook("monnify", {
      headers: { "monnify-signature": replay.signature },
      rawBody: replay.rawBody,
    });

    const after = await app.ledger.balance(merchantId);
    expect(after - before).toBe(1_000_000); // exactly one 2×₦5,000 sale
    const finalOrder = await app.repos.orders.byId(order.id);
    expect(finalOrder!.status).toBe("paid");
    const stockAfter = await app.repos.products.byId(product.id);
    expect(stockAfter!.stockQty).toBe(3);

    const report = await app.reconciliation.run();
    expect(report.clean).toBe(true);
  });
});
