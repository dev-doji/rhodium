import { buildApp, type App } from "../../src/app.js";
import { loadConfig, resetConfigCache } from "../../src/config/index.js";
import { CaptureTransport } from "../../src/modules/notification/transport.js";
import { FixedClock } from "../../src/lib/clock.js";
import { MonnifyFiatRail } from "../../src/rails/monnify-fiat-rail.js";
import type { Merchant, Product, Order } from "../../src/domain/types.js";

export interface TestApp extends App {
  channel: CaptureTransport;
  clock: FixedClock;
  fiat: MonnifyFiatRail;
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
  return { ...app, channel, clock, fiat: app.rails.fiat() as MonnifyFiatRail };
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

export function payWebhook(app: TestApp, providerRef: string, overrideAmount?: number) {
  const signed = app.fiat.mock!.simulateTransfer(providerRef, overrideAmount);
  return app.payments.handleRailWebhook("monnify", {
    headers: { "monnify-signature": signed.signature },
    rawBody: signed.rawBody,
  });
}

export function replayWebhook(app: TestApp, providerRef: string) {
  const signed = app.fiat.mock!.replayLastTransfer(providerRef);
  return app.payments.handleRailWebhook("monnify", {
    headers: { "monnify-signature": signed.signature },
    rawBody: signed.rawBody,
  });
}
