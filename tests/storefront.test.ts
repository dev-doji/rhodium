import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { buildApp } from "../src/app.js";
import { loadConfig, resetConfigCache } from "../src/config/index.js";
import { CaptureTransport } from "../src/modules/notification/transport.js";
import { buildApi } from "../src/http/api.js";

/**
 * The public web storefront — the front door that needs no Meta review.
 *
 * Two things are load-bearing here and both are about money rather than
 * markup: the catalogue must not leak anything about the vendor that a
 * stranger has no business seeing, and a hand-written cart must not be able
 * to change what an item costs or whose shop it settles into.
 */

let server: Server;
let base: string;
let app: ReturnType<typeof buildApp>;
let otpChannel: CaptureTransport;
let laptopId: string;
let soldOutId: string;
let rivalProductId: string;

beforeAll(async () => {
  resetConfigCache();
  process.env.NODE_ENV = "test";
  process.env.FIAT_ADAPTER_MODE = "mock";
  process.env.WHATSAPP_MODE = "mock";
  otpChannel = new CaptureTransport("whatsapp");
  app = buildApp({ config: loadConfig(), notificationChannels: [otpChannel] });

  await app.repos.merchants.create({
    id: "mch_shop",
    phone: "+2348030002222",
    businessName: "Circuit City",
    status: "active",
    kycState: "verified",
    cryptoEnabled: false,
    slug: "circuitcity",
    waDisplayPhone: "+234 911 046 1379",
    settlementAccountNumber: "0123456789",
    settlementBankCode: "058",
    quaiAddress: "0x0000000000000000000000000000000000000001",
  });

  const laptop = await app.commerce.createProduct({
    merchantId: "mch_shop",
    name: "Refurbished ThinkPad",
    price: 25_000_00,
    stockQty: 4,
  });
  laptopId = laptop.id;

  const soldOut = await app.commerce.createProduct({
    merchantId: "mch_shop",
    name: "Last Year's Phone",
    price: 90_000_00,
    stockQty: 0,
  });
  soldOutId = soldOut.id;

  // A second shop, to prove carts cannot reach across tenants.
  await app.repos.merchants.create({
    id: "mch_rival",
    phone: "+2348030003333",
    businessName: "Jewel Box",
    status: "active",
    kycState: "verified",
    cryptoEnabled: false,
    slug: "jewelbox",
  });
  const rival = await app.commerce.createProduct({
    merchantId: "mch_rival",
    name: "Gold Bangle",
    price: 5_000_00,
  });
  rivalProductId = rival.id;

  await app.repos.merchants.create({
    id: "mch_noslug",
    phone: "+2348030005555",
    businessName: "No Slug Shop",
    status: "active",
    kycState: "verified",
    cryptoEnabled: false,
  });
  await app.commerce.createProduct({
    merchantId: "mch_noslug",
    name: "Unslugged Widget",
    price: 1_000_00,
  });

  await app.repos.merchants.create({
    id: "mch_shut",
    phone: "+2348030004444",
    businessName: "Closed Down",
    status: "suspended",
    kycState: "verified",
    cryptoEnabled: false,
    slug: "closeddown",
  });

  const api = buildApi(app);
  await new Promise<void>((r) => {
    server = api.listen(0, () => r());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(() => {
  server?.close();
});

interface ShopProduct {
  id: string;
  name: string;
  price: number;
  priceFormatted: string;
  imageUrl?: string;
  inStock: boolean;
  stockQty?: number;
}
interface ShopBody {
  shop: {
    handle?: string;
    businessName: string;
    whatsapp?: string;
    products: ShopProduct[];
    settlementAccountNumber?: string;
    kycState?: string;
  };
}
interface OrderBody {
  orderId: string;
  amount: number;
  checkoutUrl: string;
}
interface ErrorBody {
  error: string;
  message: string;
}

const getShop = (handle: string) => fetch(`${base}/api/shop/${handle}`);
const shopJson = async (handle: string): Promise<ShopBody> =>
  (await getShop(handle)).json() as Promise<ShopBody>;
const order = (handle: string, body: unknown) =>
  fetch(`${base}/api/shop/${handle}/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("public shop catalogue", () => {
  it("serves the shop by its handle, with no login", async () => {
    const res = await getShop("circuitcity");
    expect(res.status).toBe(200);
    const { shop } = (await res.json()) as ShopBody;
    expect(shop.businessName).toBe("Circuit City");
    expect(shop.products).toHaveLength(2);
  });

  it("never exposes the vendor's private details to a buyer", async () => {
    const { shop } = await shopJson("circuitcity");
    const blob = JSON.stringify(shop);
    // Bank account, settlement wallet, phone and internal id are all things a
    // stranger browsing a shop must never receive.
    expect(blob).not.toContain("0123456789");
    expect(blob).not.toContain("+2348030002222");
    expect(blob).not.toContain("0x0000000000000000000000000000000000000001");
    expect(blob).not.toContain("mch_shop");
    expect(shop.settlementAccountNumber).toBeUndefined();
    expect(shop.kycState).toBeUndefined();
  });

  it("reports availability without revealing stock levels", async () => {
    const { shop } = await shopJson("circuitcity");
    const laptop = shop.products.find((p) => p.id === laptopId)!;
    const gone = shop.products.find((p) => p.id === soldOutId)!;
    expect(laptop.inStock).toBe(true);
    expect(gone.inStock).toBe(false);
    expect(laptop.stockQty).toBeUndefined();
  });

  it("resolves a shop by raw merchant id when it has no slug yet", async () => {
    // `shopLink` and `/api/me` both build their URL from `slug ?? id`, and a
    // merchant created outside onboarding (seed script, admin insert) has no
    // slug. A slug-only lookup 404s the exact link the vendor was just told to
    // share, which is how this shipped broken the first time.
    const res = await getShop("mch_noslug");
    expect(res.status).toBe(200);
    const { shop } = (await res.json()) as ShopBody;
    expect(shop.businessName).toBe("No Slug Shop");
  });

  it("404s an unknown handle and a suspended shop alike", async () => {
    expect((await getShop("nosuchshop")).status).toBe(404);
    // Suspended shops 404 rather than 403: a closed shop should be
    // indistinguishable from one that never existed.
    expect((await getShop("closeddown")).status).toBe(404);
  });
});

describe("ordering from the storefront", () => {
  it("creates an order priced from the catalogue and returns a checkout link", async () => {
    const res = await order("circuitcity", {
      buyerName: "Ada Okeke",
      buyerPhone: "08030001234",
      lines: [{ productId: laptopId, qty: 2 }],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as OrderBody;
    expect(body.amount).toBe(50_000_00);
    expect(body.checkoutUrl).toContain(`/checkout/${body.orderId}`);

    const saved = await app.repos.orders.byId(body.orderId);
    expect(saved?.merchantId).toBe("mch_shop");

    // The order carries a buyer id; the contact details live on the buyer, so
    // that is where the vendor's delivery information has to be.
    const buyer = await app.repos.buyers.byId(saved!.buyerRef);
    expect(buyer?.phoneOrRef).toBe("08030001234");
    expect(buyer?.name).toBe("Ada Okeke");
  });

  it("keeps a repeat buyer as one customer rather than a new one each time", async () => {
    const first = await order("circuitcity", {
      buyerName: "Bola Ade",
      buyerPhone: "08039998888",
      lines: [{ productId: laptopId, qty: 1 }],
    });
    const second = await order("circuitcity", {
      buyerName: "Bola Ade",
      buyerPhone: "08039998888",
      lines: [{ productId: laptopId, qty: 1 }],
    });
    const a = await app.repos.orders.byId(((await first.json()) as OrderBody).orderId);
    const b = await app.repos.orders.byId(((await second.json()) as OrderBody).orderId);
    expect(a!.buyerRef).toBe(b!.buyerRef);
  });

  it("ignores any price the client sends", async () => {
    const res = await order("circuitcity", {
      buyerPhone: "08030001234",
      lines: [{ productId: laptopId, qty: 1, price: 1, priceNaira: 1 }],
    });
    const body = (await res.json()) as OrderBody;
    // Server-side lookup wins: still full price, not the ₦0.01 the cart asked for.
    expect(body.amount).toBe(25_000_00);
  });

  it("refuses a cart holding another shop's product", async () => {
    const res = await order("circuitcity", {
      buyerPhone: "08030001234",
      lines: [{ productId: rivalProductId, qty: 1 }],
    });
    // Otherwise a crafted cart would settle Jewel Box's goods into Circuit
    // City's bank account.
    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).message).toMatch(/not sold by this shop/i);
  });

  it("rejects carts that are empty, oversized, or badly quantified", async () => {
    const phone = "08030001234";
    expect((await order("circuitcity", { buyerPhone: phone, lines: [] })).status).toBe(422);
    expect(
      (await order("circuitcity", { buyerPhone: phone, lines: [{ productId: laptopId, qty: 0 }] }))
        .status,
    ).toBe(422);
    expect(
      (await order("circuitcity", { buyerPhone: phone, lines: [{ productId: laptopId, qty: -3 }] }))
        .status,
    ).toBe(422);
    expect(
      (await order("circuitcity", { buyerPhone: phone, lines: [{ productId: laptopId, qty: 2.5 }] }))
        .status,
    ).toBe(422);
    expect(
      (await order("circuitcity", { buyerPhone: phone, lines: [{ productId: laptopId, qty: 500 }] }))
        .status,
    ).toBe(422);
  });

  it("requires a phone number, since the vendor has to deliver to someone", async () => {
    const res = await order("circuitcity", { lines: [{ productId: laptopId, qty: 1 }] });
    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).message).toMatch(/phone/i);
  });

  it("will not take an order for a suspended shop", async () => {
    const res = await order("closeddown", {
      buyerPhone: "08030001234",
      lines: [{ productId: laptopId, qty: 1 }],
    });
    expect(res.status).toBe(404);
  });
});

describe("finding the shop in the first place", () => {
  it("hands the vendor her web shop link when she asks the bot for it", async () => {
    const reply = await app.whatsapp.handleInbound({
      from: "+2348030002222",
      text: "link",
    });
    // The storefront exists, but until this reply carried it there was no way
    // for a vendor to discover her own URL — which made the whole page
    // unreachable in practice.
    expect(reply).toContain("/s/circuitcity");
  });

  it("puts the shop link on /api/me so the dashboard can show it", async () => {
    // Sign in the way the dashboard does. `issueToken` is private, so the OTP
    // is read off the transport rather than reaching past the public API — a
    // test that shortcuts the real login proves nothing about the real login.
    await fetch(`${base}/auth/otp/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+2348030002222" }),
    });
    const sent = otpChannel.sent.map((m) => m.message).join(" ");
    const code = /\b(\d{6})\b/.exec(sent)?.[1];
    expect(code, "no OTP reached the transport").toBeTruthy();

    const auth = await fetch(`${base}/auth/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+2348030002222", code }),
    });
    const { token } = (await auth.json()) as { token: string };
    expect(token, "login did not return a token").toBeTruthy();

    const res = await fetch(`${base}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as { shopUrl?: string };
    expect(body.shopUrl).toContain("/s/circuitcity");
  });
});

describe("backfilling demo product images", () => {
  // Read lazily from the built app: a module-scope process.env read runs at
  // collection time, before beforeAll has loaded the environment, and would
  // silently send an empty secret.
  const backfill = (body: unknown) =>
    fetch(`${base}/admin/backfill-product-images`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${app.config.APP_SECRET}`,
      },
      body: JSON.stringify(body),
    });

  it("refuses without the admin secret", async () => {
    const res = await fetch(`${base}/admin/backfill-product-images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("fills a blank image and never overwrites an existing one", async () => {
    const merchant = await app.repos.merchants.create({
      id: "mch_backfill",
      phone: "+2348030007777",
      businessName: "Backfill Shop",
      status: "active",
      kycState: "verified",
      cryptoEnabled: false,
      slug: "backfillshop",
    });
    // One demo product with no image, one already photographed, one that is
    // not in the demo catalogue at all.
    const blank = await app.commerce.createProduct({
      merchantId: merchant.id, name: "Smart Watch", price: 55_000_00,
    });
    const owned = await app.commerce.createProduct({
      merchantId: merchant.id, name: "Wireless Mouse", price: 12_000_00,
      imageUrl: "/media/the-vendors-own-photo.jpg",
    });
    const foreign = await app.commerce.createProduct({
      merchantId: merchant.id, name: "Handmade Soap", price: 2_000_00,
    });

    const dry = await backfill({ merchantId: merchant.id, dryRun: true });
    expect(((await dry.json()) as { patched: number }).patched).toBe(1);
    // A dry run must not have written anything.
    expect((await app.repos.products.byId(blank.id))?.imageUrl).toBeUndefined();

    const res = await backfill({ merchantId: merchant.id });
    const body = (await res.json()) as {
      patched: number; alreadyHadImage: number; notInDemoCatalogue: number;
    };
    expect(body.patched).toBe(1);
    expect(body.alreadyHadImage).toBe(1);
    expect(body.notInDemoCatalogue).toBe(1);

    expect((await app.repos.products.byId(blank.id))?.imageUrl).toBe("/img/products/smart-watch.jpg");
    // The vendor's own photograph survives untouched — this is the guarantee
    // that makes the endpoint safe to run against production.
    expect((await app.repos.products.byId(owned.id))?.imageUrl).toBe("/media/the-vendors-own-photo.jpg");
    expect((await app.repos.products.byId(foreign.id))?.imageUrl).toBeUndefined();
  });

  it("is idempotent", async () => {
    const again = await backfill({ merchantId: "mch_backfill" });
    expect(((await again.json()) as { patched: number }).patched).toBe(0);
  });
});

describe("the ₦100 test shop", () => {
  const create = (body: unknown) =>
    fetch(`${base}/admin/test-shop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${app.config.APP_SECRET}`,
      },
      body: JSON.stringify(body),
    });

  it("needs the admin secret", async () => {
    const res = await fetch(`${base}/admin/test-shop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+2348000000101" }),
    });
    expect(res.status).toBe(401);
  });

  it("creates a shop of ₦100 items that is immediately browsable", async () => {
    const res = await create({
      phone: "+2348000000101",
      businessName: "Rhodium Test Shop",
      bankCode: "058",
      accountNumber: "0123456789",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      handle: string; items: number; shopUrl: string; merchantId: string;
    };
    expect(body.items).toBe(4);
    expect(body.shopUrl).toContain(`/s/${body.handle}`);

    // The whole point is that a buyer can reach it, so check the public view.
    const { shop } = await shopJson(body.handle);
    expect(shop.products).toHaveLength(4);
    for (const p of shop.products) {
      expect(p.price).toBe(100_00);
      expect(p.imageUrl).toBeTruthy();
    }
  });

  it("refuses to reuse a number another merchant already has", async () => {
    // Two merchants on one number would make vendor commands ambiguous.
    const res = await create({ phone: "+2348000000101" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).message).toMatch(/already uses that number/i);
  });
});
