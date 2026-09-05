import { buildApp, type App } from "../../src/app.js";
import { loadConfig, resetConfigCache } from "../../src/config/index.js";
import { CaptureTransport } from "../../src/modules/notification/transport.js";
import { FixedClock } from "../../src/lib/clock.js";
import type { PaymentRail } from "../../src/rails/types.js";
import type { Merchant, Product, Order } from "../../src/domain/types.js";

/** The mock surface both bank rails expose. */
export interface SignedWebhook {
  signature: string;
  rawBody: string;
}
export type MockableFiatRail = PaymentRail & {
  mock?: {
    simulateTransfer(ref: string, overrideAmount?: number): SignedWebhook;
    replayLastTransfer(ref: string): SignedWebhook;
  };
};

/**
 * Each rail reads its signature from its own header.
 *
 * Exported because the harness is not the only place that posts a webhook,
 * and a second copy of this mapping is how the suite ends up green on one
 * provider and broken on another.
 */
export function signatureHeader(railId: string): string {
  switch (railId) {
    case "monnify":
      return "monnify-signature";
    case "paystack":
      return "x-paystack-signature";
    default:
      throw new Error(
        `no webhook signature header known for rail "${railId}" — add it here ` +
          "when a new bank rail is introduced",
      );
  }
}

export interface TestApp extends App {
  channel: CaptureTransport;
  clock: FixedClock;
  /**
   * The configured bank rail, whichever FIAT_PROVIDER selects. Deliberately
   * NOT pinned to Monnify: production runs Paystack, and a suite that only
   * ever exercises the other rail proves nothing about what is deployed.
   */
  fiat: MockableFiatRail;
}

export function makeApp(): TestApp {
  resetConfigCache();
  process.env.NODE_ENV = "test";
  process.env.FIAT_ADAPTER_MODE = "mock";
  process.env.WHATSAPP_MODE = "mock";
  const config = loadConfig();
  const clock = new FixedClock(new Date("2026-07-21T09:00:00Z"));
  const channel = new CaptureTransport("whatsapp");
  const app = buildApp({ config, clock, notificationChannels: [channel] });
  return { ...app, channel, clock, fiat: app.rails.fiat() as MockableFiatRail };
}

export async function seedMerchant(app: App, over: Partial<Merchant> = {}): Promise<Merchant> {
  return app.repos.merchants.create({
    id: over.id ?? `mch_${Math.random().toString(36).slice(2, 8)}`,
    phone: over.phone ?? "+2348030000001",
    businessName: over.businessName ?? "Amaka Beauty",
    status: "active",
    kycState: "verified",
    cryptoEnabled: false,
    settlementBankCode: "058",
    settlementAccountNumber: "0123456789",
    ...over,
  });
}

export async function seedProduct(
  app: App,
  merchantId: string,
  priceKobo = 500_000,
  stockQty?: number,
): Promise<Product> {
  return app.commerce.createProduct({
    merchantId,
    name: "Red Lipstick",
    price: priceKobo,
    stockQty,
  });
}

/** Drive a full order to an issued DVA, returns order + providerRef. */
export async function orderWithDva(
  app: App,
  merchantId: string,
  productId: string,
  qty = 1,
  buyer = "+2348090000009",
): Promise<{ order: Order; providerRef: string }> {
  const order = await app.commerce.createOrder({
    merchantId,
    buyerRef: buyer,
    lines: [{ productId, qty }],
  });
  const instruction = await app.payments.requestPayment(order.id);
  return { order, providerRef: instruction.providerRef };
}

function post(app: TestApp, signed: SignedWebhook) {
  return app.payments.handleRailWebhook(app.fiat.id, {
    headers: { [signatureHeader(app.fiat.id)]: signed.signature },
    rawBody: signed.rawBody,
  });
}

export function payWebhook(app: TestApp, providerRef: string, overrideAmount?: number) {
  return post(app, app.fiat.mock!.simulateTransfer(providerRef, overrideAmount));
}

export function replayWebhook(app: TestApp, providerRef: string) {
  return post(app, app.fiat.mock!.replayLastTransfer(providerRef));
}
