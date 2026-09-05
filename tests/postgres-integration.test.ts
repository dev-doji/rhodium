import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig, resetConfigCache } from "../src/config/index.js";
import { CaptureTransport } from "../src/modules/notification/transport.js";
import { createPrismaRepositories } from "../src/db/prisma/prisma-repositories.js";
import { PrismaIdempotencyStore } from "../src/db/prisma/prisma-idempotency.js";
import { prisma, disconnectPrisma } from "../src/db/prisma/client.js";
import type { MockableFiatRail } from "./helpers/harness.js";
import { ref } from "../src/lib/ids.js";

/**
 * Real-Postgres integration. Runs ONLY when DATABASE_URL is set (CI + local
 * `npm run db:up`). Proves the exact same magic-moment loop — including the
 * SERIALIZABLE atomic ledger append and the DB-backed idempotency store — works
 * against a live database, not just the in-memory doubles.
 */
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

/**
 * Both bank rails expose the same mock surface, so this test can drive
 * whichever one FIAT_PROVIDER selects instead of assuming Monnify.
 *
 * It used to ask the registry for the configured rail and then post the
 * webhook as "monnify" regardless, so the moment FIAT_PROVIDER moved to
 * paystack it failed with "invalid monnify signature" — a real config change
 * showing up as a mysterious signature error in an unrelated Postgres test.
 */
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
    const fiat = app.rails.fiat() as MockableFiatRail;
    expect(fiat.mock, `rail ${fiat.id} has no mock server`).toBeTruthy();
    const header = fiat.webhookSignatureHeader!;

    const before = await app.ledger.balance(merchantId);
    const signed = fiat.mock!.simulateTransfer(payment!.providerRef);
    await app.payments.handleRailWebhook(fiat.id, {
      headers: { [header]: signed.signature },
      rawBody: signed.rawBody,
    });

    // Replay the identical webhook — DB-backed idempotency must dedupe it.
    const replay = fiat.mock!.replayLastTransfer(payment!.providerRef);
    await app.payments.handleRailWebhook(fiat.id, {
      headers: { [header]: replay.signature },
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

d("payment repository round-trips every field", () => {
  it("preserves instructionJson through Postgres", async () => {
    const repos = createPrismaRepositories(prisma());
    const merchant = await repos.merchants.create({
      id: ref("mch"), phone: `+234${Date.now() % 10_000_000_000}`,
      businessName: "Roundtrip Co", status: "active", kycState: "verified",
      cryptoEnabled: false,
    });
    const order = await repos.orders.create({
      id: ref("ord"), merchantId: merchant.id, buyerRef: "+2349032621846",
      items: [], amount: 650_000, rail: "fiat", status: "awaiting_payment",
    });
    const snapshot = JSON.stringify({
      railId: "paystack", instructionType: "dva", providerRef: order.id,
      amount: 650_000, accountNumber: "9816867854", bankName: "Wema Bank",
      accountName: "FONIOLABS/BUYER RHODIUM",
    });

    await repos.payments.create({
      id: ref("pay"), orderId: order.id, railId: "paystack",
      providerRef: order.id, instructionType: "dva", amount: 650_000,
      status: "pending", instructionJson: snapshot,
    });

    // The in-memory repo spreads the whole object, so it carries any new field
    // for free. The Postgres map lists fields by hand — which is how a missing
    // `instructionJson` there passed the whole suite and still showed buyers a
    // blank account number in production. Assert the real database.
    const read = await repos.payments.byOrderId(order.id);
    expect(read?.instructionJson).toBe(snapshot);
    expect(JSON.parse(read!.instructionJson!).accountNumber).toBe("9816867854");
  });
});
