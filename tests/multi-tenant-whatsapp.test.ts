import { describe, it, expect, beforeEach } from "vitest";
import { makeApp, seedMerchant, seedProduct, payWebhook, type TestApp } from "./helpers/harness.js";
import { EmbeddedSignupService } from "../src/modules/whatsapp/embedded-signup.js";
import { createInMemoryRepositories } from "../src/db/memory/in-memory-repositories.js";
import { ValidationError } from "../src/lib/errors.js";
import type { Merchant } from "../src/domain/types.js";

const PLATFORM = "PLATFORM_PNID"; // Rhodium's own number
const AMAKA_PNID = "555000111"; // a vendor's own Cloud API number
const TOLU_PNID = "555000222"; // a second vendor's

beforeEach(() => {
  process.env.WHATSAPP_PHONE_NUMBER_ID = PLATFORM;
});

/** A merchant who has connected their own WhatsApp number. */
async function seedTenant(
  app: TestApp,
  over: Partial<Merchant> & { waPhoneNumberId: string },
): Promise<Merchant> {
  return seedMerchant(app, {
    waDisplayPhone: "+234 803 680 3974",
    ...over,
  });
}

describe("multi-tenant WhatsApp — a vendor's own number", () => {
  it("shows the vendor's catalogue to a buyer who says anything at all", async () => {
    const app = makeApp();
    const amaka = await seedTenant(app, { waPhoneNumberId: AMAKA_PNID });
    await seedProduct(app, amaka.id, 500_000);

    const reply = await app.whatsapp.handleInbound({
      from: "+2348090001111",
      text: "hello, do you have anything in red?",
      toPhoneNumberId: AMAKA_PNID,
    });

    expect(reply).toContain("Amaka Beauty");
    expect(reply).toMatch(/Red Lipstick/);
    // The thing this whole feature exists to prevent: a buyer being asked to
    // open a merchant account by the shop they're trying to buy from.
    expect(reply).not.toMatch(/business name/i);
    expect(await app.repos.merchants.byPhone("+2348090001111")).toBeNull();
  });

  it("replies FROM the vendor's number, not the platform's", async () => {
    const app = makeApp();
    const amaka = await seedTenant(app, { waPhoneNumberId: AMAKA_PNID });
    await seedProduct(app, amaka.id);

    await app.whatsapp.handleInbound({
      from: "+2348090002222",
      text: "hi",
      toPhoneNumberId: AMAKA_PNID,
    });

    expect(app.channel.sent.at(-1)!.from).toBe(AMAKA_PNID);
  });

  it("still gives the VENDOR their commands on their own number", async () => {
    const app = makeApp();
    const amaka = await seedTenant(app, { waPhoneNumberId: AMAKA_PNID });

    const added = await app.whatsapp.handleInbound({
      from: amaka.phone,
      text: "add Gloss Set 12000",
      toPhoneNumberId: AMAKA_PNID,
    });

    expect(added).toMatch(/Added \*?Gloss Set/);
    expect(await app.commerce.listProducts(amaka.id)).toHaveLength(1);
  });

  it("ignores a rival's shop deep link on a vendor's number", async () => {
    const app = makeApp();
    const amaka = await seedTenant(app, { waPhoneNumberId: AMAKA_PNID });
    await seedProduct(app, amaka.id);
    const tolu = await seedMerchant(app, {
      phone: "+2348030009999",
      businessName: "Tolu Fabrics",
    });
    await seedProduct(app, tolu.id);

    const reply = await app.whatsapp.handleInbound({
      from: "+2348090003333",
      text: `shop-${tolu.id}`,
      toPhoneNumberId: AMAKA_PNID,
    });

    expect(reply).toContain("Amaka Beauty");
    expect(reply).not.toContain("Tolu Fabrics");
  });

  it("keeps one buyer's two shop conversations apart", async () => {
    const app = makeApp();
    const amaka = await seedTenant(app, { waPhoneNumberId: AMAKA_PNID });
    await seedProduct(app, amaka.id, 500_000);
    const tolu = await seedTenant(app, {
      waPhoneNumberId: TOLU_PNID,
      phone: "+2348030008888",
      businessName: "Tolu Fabrics",
    });
    await app.commerce.createProduct({ merchantId: tolu.id, name: "Ankara Wrap", price: 900_000 });

    const buyer = "+2348090004444";
    await app.whatsapp.handleInbound({ from: buyer, text: "hi", toPhoneNumberId: AMAKA_PNID });
    await app.whatsapp.handleInbound({ from: buyer, text: "hi", toPhoneNumberId: TOLU_PNID });

    // Picking "1" on each number must resolve against THAT shop's list.
    const atAmaka = await app.whatsapp.handleInbound({
      from: buyer,
      text: "1",
      toPhoneNumberId: AMAKA_PNID,
    });
    const atTolu = await app.whatsapp.handleInbound({
      from: buyer,
      text: "1",
      toPhoneNumberId: TOLU_PNID,
    });

    expect(atAmaka).toMatch(/Red Lipstick/);
    expect(atTolu).toMatch(/Ankara Wrap/);
  });

  it("runs a whole purchase on the vendor's number, receipts included", async () => {
    const app = makeApp();
    const amaka = await seedTenant(app, { waPhoneNumberId: AMAKA_PNID });
    await seedProduct(app, amaka.id, 300_000);
    const buyer = "+2348090005555";

    await app.whatsapp.handleInbound({ from: buyer, text: "hey", toPhoneNumberId: AMAKA_PNID });
    await app.whatsapp.handleInbound({ from: buyer, text: "1", toPhoneNumberId: AMAKA_PNID });
    const pay = await app.whatsapp.handleInbound({
      from: buyer,
      text: "1", // bank transfer
      toPhoneNumberId: AMAKA_PNID,
    });
    expect(pay).toMatch(/Transfer to/i);

    const order = (await app.repos.orders.listByMerchant(amaka.id))[0]!;
    const payment = await app.repos.payments.byOrderId(order.id);
    await payWebhook(app, payment!.providerRef);

    expect((await app.repos.orders.byId(order.id))!.status).toBe("paid");
    const receipt = app.channel.sent.find((s) => s.message.includes("Receipt from"));
    const confirmation = app.channel.sent.find((s) => s.message.includes("You've been paid"));
    expect(receipt).toBeDefined();
    expect(confirmation).toBeDefined();
    // Both sides of the sale are answered on the number the buyer messaged —
    // the only number with an open 24-hour window.
    expect(receipt!.from).toBe(AMAKA_PNID);
    expect(confirmation!.from).toBe(AMAKA_PNID);
  });

  it("gives a connected vendor their own number as the shop link", async () => {
    const app = makeApp();
    const amaka = await seedTenant(app, {
      waPhoneNumberId: AMAKA_PNID,
      waDisplayPhone: "+234 803 680 3974",
    });

    const link = await app.whatsapp.handleInbound({
      from: amaka.phone,
      text: "link",
      toPhoneNumberId: AMAKA_PNID,
    });

    expect(link).toContain("https://wa.me/2348036803974");
    expect(link).not.toContain("shop-"); // no deep-link payload needed any more
  });
});

describe("multi-tenant WhatsApp — Rhodium's own number is unchanged", () => {
  it("still onboards an unknown sender on the platform number", async () => {
    const app = makeApp();
    const reply = await app.whatsapp.handleInbound({
      from: "+2348090006666",
      text: "hi",
      toPhoneNumberId: PLATFORM,
    });
    expect(reply).toMatch(/business name/i);
  });

  it("treats an unrecognised phone_number_id as the platform, not a shop", async () => {
    const app = makeApp();
    const reply = await app.whatsapp.handleInbound({
      from: "+2348090007777",
      text: "hi",
      toPhoneNumberId: "an-id-we-have-never-seen",
    });
    expect(reply).toMatch(/business name/i);
  });

  it("still serves shop deep links on the platform number", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    await seedProduct(app, merchant.id);
    const reply = await app.whatsapp.handleInbound({
      from: "+2348090008888",
      text: `shop-${merchant.id}`,
      toPhoneNumberId: PLATFORM,
    });
    expect(reply).toMatch(/Red Lipstick/);
  });

  it("rescues a buyer who said 'hi' first and landed in onboarding", async () => {
    const app = makeApp();
    const shop = await seedMerchant(app, { businessName: "Circuit City" });
    await seedProduct(app, shop.id, 650_000);
    const buyer = "+2349032621846";

    // The real sequence a buyer performs: greet, then tap the link.
    const greeting = await app.whatsapp.handleInbound({
      from: buyer, text: "Hi", toPhoneNumberId: PLATFORM,
    });
    expect(greeting).toMatch(/business name/i);

    const catalogue = await app.whatsapp.handleInbound({
      from: buyer, text: `shop-${shop.id}`, toPhoneNumberId: PLATFORM,
    });

    // Previously the link was swallowed as the answer to "business name?",
    // registering a merchant literally called "shop-mch_…".
    expect(catalogue).toContain("Circuit City");
    expect(catalogue).not.toMatch(/bank account|business name/i);
    const junk = await app.repos.merchants.byPhone(buyer);
    expect(junk).toBeNull();
  });

  it("still lets a business called 'Shop Rite' onboard", async () => {
    const app = makeApp();
    const phone = "+2348099887766";
    await app.whatsapp.handleInbound({ from: phone, text: "hello", toPhoneNumberId: PLATFORM });
    // Tightening the deep-link pattern to require `mch_` is what protects this:
    // a looser /^shop[-\s]+(\S+)/ would eat the name and answer "shop
    // unavailable" to a vendor who is simply called Shop Rite.
    const reply = await app.whatsapp.handleInbound({
      from: phone, text: "Shop Rite", toPhoneNumberId: PLATFORM,
    });
    expect(reply).toMatch(/account number/i);
  });

  it("lets a registered vendor shop another store from their own phone", async () => {
    const app = makeApp();
    const vendor = await seedMerchant(app, {
      phone: "+2349110461379",
      businessName: "Circuit City",
    });
    const other = await seedMerchant(app, {
      phone: "+2348030007777",
      businessName: "Diadem Store",
    });
    await seedProduct(app, other.id, 650_000);

    // A vendor tapping a shop link used to fall through to vendorCommand, which
    // does not know "shop-mch_…" and answered "Didn't get that" — leaving them
    // unable to buy anywhere, or to test their own storefront.
    const reply = await app.whatsapp.handleInbound({
      from: vendor.phone,
      text: `shop-${other.id}`,
      toPhoneNumberId: PLATFORM,
    });

    expect(reply).toContain("Diadem Store");
    expect(reply).not.toMatch(/didn't get that/i);
  });

  it("still gives a vendor their own link for a bare 'shop'", async () => {
    const app = makeApp();
    const vendor = await seedMerchant(app, { phone: "+2349110461380" });
    // The deep-link regex needs an id after "shop", so the bare word must still
    // reach vendorCommand rather than being swallowed as a buyer link.
    const reply = await app.whatsapp.handleInbound({
      from: vendor.phone,
      text: "shop",
      toPhoneNumberId: PLATFORM,
    });
    expect(reply).toContain(`shop-${vendor.id}`);
  });

  it("offers a vendor the connect link and reports once connected", async () => {
    const app = makeApp();
    const merchant = await seedMerchant(app);
    const offer = await app.whatsapp.handleInbound({
      from: merchant.phone,
      text: "connect",
      toPhoneNumberId: PLATFORM,
    });
    // Not configured in tests — it must say so plainly rather than hand out a
    // broken Facebook URL.
    expect(offer).toMatch(/isn't switched on yet|dialog\/oauth/);

    await app.repos.merchants.update(merchant.id, { waPhoneNumberId: AMAKA_PNID });
    const already = await app.whatsapp.handleInbound({
      from: merchant.phone,
      text: "connect",
      toPhoneNumberId: PLATFORM,
    });
    expect(already).toMatch(/already connected/i);
  });
});

describe("Coexistence — vendor keeps her WhatsApp Business app", () => {
  it("goes quiet on a thread the vendor answered by hand", async () => {
    const app = makeApp();
    const amaka = await seedTenant(app, { waPhoneNumberId: AMAKA_PNID });
    await seedProduct(app, amaka.id);
    const buyer = "+2348090009999";

    const first = await app.whatsapp.handleInbound({
      from: buyer, text: "hi", toPhoneNumberId: AMAKA_PNID,
    });
    expect(first).toContain("Amaka Beauty");

    // She replies from her phone — Meta echoes it to us.
    app.whatsapp.noteVendorReply(AMAKA_PNID, buyer);

    const sentBefore = app.channel.sent.length;
    const second = await app.whatsapp.handleInbound({
      from: buyer, text: "how much for the lipstick?", toPhoneNumberId: AMAKA_PNID,
    });
    expect(second).toBe("");
    // Nothing sent at all — not even an empty message.
    expect(app.channel.sent.length).toBe(sentBefore);
  });

  it("mutes only that one thread, not the whole number", async () => {
    const app = makeApp();
    const amaka = await seedTenant(app, { waPhoneNumberId: AMAKA_PNID });
    await seedProduct(app, amaka.id);

    app.whatsapp.noteVendorReply(AMAKA_PNID, "+2348090001111");

    const other = await app.whatsapp.handleInbound({
      from: "+2348090002222", text: "hello", toPhoneNumberId: AMAKA_PNID,
    });
    // A vendor handling one order personally still wants the rest served.
    expect(other).toContain("Amaka Beauty");
  });

  it("does not advance the buyer's flow while muted", async () => {
    const app = makeApp();
    const amaka = await seedTenant(app, { waPhoneNumberId: AMAKA_PNID });
    await seedProduct(app, amaka.id, 500_000);
    const buyer = "+2348090003333";

    await app.whatsapp.handleInbound({ from: buyer, text: "hi", toPhoneNumberId: AMAKA_PNID });
    app.whatsapp.noteVendorReply(AMAKA_PNID, buyer);
    await app.whatsapp.handleInbound({ from: buyer, text: "1", toPhoneNumberId: AMAKA_PNID });

    // That "1" must not have been eaten as a product choice — when the window
    // lapses she should still be at the catalogue, not halfway to an order.
    expect(await app.repos.orders.listByMerchant(amaka.id)).toHaveLength(0);
  });
});

describe("Embedded Signup", () => {
  const cfg = {
    appId: "1534245258196461",
    appSecret: "app-secret",
    configId: "2976386586040947",
    redirectUri: "https://rhodium.example/oauth/whatsapp/callback",
    stateSecret: "state-secret",
  };

  /** Stubs the four Graph calls the signup makes, in order. */
  function stubGraph(): typeof fetch {
    return (async (url: string) => {
      const u = String(url);
      const body = u.includes("/oauth/access_token")
        ? { access_token: "vendor-token" }
        : u.includes("/debug_token")
          ? {
              data: {
                granular_scopes: [
                  { scope: "whatsapp_business_management", target_ids: ["WABA_1"] },
                ],
              },
            }
          : u.includes("/phone_numbers")
            ? { data: [{ id: AMAKA_PNID, display_phone_number: "+234 803 680 3974" }] }
            : { success: true };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
  }

  it("connects the vendor's number from an authorisation code", async () => {
    const repos = createInMemoryRepositories();
    const merchant = await repos.merchants.create({
      id: "mch_signup",
      phone: "+2348030000077",
      businessName: "Amaka Beauty",
      status: "active",
      kycState: "verified",
      cryptoEnabled: false,
    });
    const signup = new EmbeddedSignupService(repos, cfg, stubGraph());

    const connected = await signup.completeSignup("CODE", signup.signState(merchant.id));

    expect(connected.waPhoneNumberId).toBe(AMAKA_PNID);
    const saved = await repos.merchants.byWaPhoneNumberId(AMAKA_PNID);
    expect(saved?.id).toBe(merchant.id);
    expect(saved?.waBusinessAccountId).toBe("WABA_1");
    expect(saved?.waDisplayPhone).toBe("+234 803 680 3974");
  });

  it("rejects a state that wasn't signed by us", async () => {
    const repos = createInMemoryRepositories();
    const signup = new EmbeddedSignupService(repos, cfg, stubGraph());
    // The callback is a public URL: an attacker who could forge state would
    // attach their number to someone else's shop.
    await expect(signup.completeSignup("CODE", "mch_victim.deadbeef")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("refuses to hand one number to two shops", async () => {
    const repos = createInMemoryRepositories();
    const first = await repos.merchants.create({
      id: "mch_first",
      phone: "+2348030000088",
      businessName: "First",
      status: "active",
      kycState: "verified",
      cryptoEnabled: false,
      waPhoneNumberId: AMAKA_PNID,
    });
    const second = await repos.merchants.create({
      id: "mch_second",
      phone: "+2348030000099",
      businessName: "Second",
      status: "active",
      kycState: "verified",
      cryptoEnabled: false,
    });
    const signup = new EmbeddedSignupService(repos, cfg, stubGraph());

    await expect(
      signup.completeSignup("CODE", signup.signState(second.id)),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await repos.merchants.byWaPhoneNumberId(AMAKA_PNID))!.id).toBe(first.id);
  });

  it("builds a signup URL carrying the signed state", () => {
    const repos = createInMemoryRepositories();
    const signup = new EmbeddedSignupService(repos, cfg, stubGraph());
    const url = new URL(signup.signupUrl("mch_abc"));
    expect(url.searchParams.get("config_id")).toBe(cfg.configId);
    expect(url.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
    expect(signup.verifyState(url.searchParams.get("state")!)).toBe("mch_abc");
  });
});

describe("human-readable shop handles", () => {
  it("opens a shop from its handle instead of a raw id", async () => {
    const app = makeApp();
    const shop = await seedMerchant(app, { businessName: "Circuit City", slug: "circuitcity" });
    await seedProduct(app, shop.id, 650_000);

    const reply = await app.whatsapp.handleInbound({
      from: "+2348090001010", text: "shop-circuitcity", toPhoneNumberId: PLATFORM,
    });
    expect(reply).toContain("Circuit City");
    expect(reply).toMatch(/Red Lipstick/);
  });

  it("is case-insensitive, because people capitalise links", async () => {
    const app = makeApp();
    const shop = await seedMerchant(app, { businessName: "Circuit City", slug: "circuitcity" });
    await seedProduct(app, shop.id);
    const reply = await app.whatsapp.handleInbound({
      from: "+2348090002020", text: "Shop-CircuitCity", toPhoneNumberId: PLATFORM,
    });
    expect(reply).toContain("Circuit City");
  });

  it("mints a handle at onboarding and shares it in the link", async () => {
    const app = makeApp();
    const phone = "+2348090003030";
    await app.whatsapp.handleInbound({ from: phone, text: "hi", toPhoneNumberId: PLATFORM });
    await app.whatsapp.handleInbound({ from: phone, text: "Circuit City", toPhoneNumberId: PLATFORM });
    await app.whatsapp.handleInbound({ from: phone, text: "0123456789", toPhoneNumberId: PLATFORM });
    await app.whatsapp.handleInbound({ from: phone, text: "2", toPhoneNumberId: PLATFORM });

    const merchant = await app.repos.merchants.byPhone(phone);
    expect(merchant!.slug).toBe("circuitcity");

    const link = await app.whatsapp.handleInbound({ from: phone, text: "link", toPhoneNumberId: PLATFORM });
    expect(link).toContain("shop-circuitcity");
    expect(link).not.toContain(merchant!.id);
  });

  it("suffixes a handle that is already taken", async () => {
    const app = makeApp();
    await seedMerchant(app, { businessName: "Circuit City", slug: "circuitcity" });
    const phone = "+2348090004040";
    await app.whatsapp.handleInbound({ from: phone, text: "hi", toPhoneNumberId: PLATFORM });
    await app.whatsapp.handleInbound({ from: phone, text: "Circuit City", toPhoneNumberId: PLATFORM });
    await app.whatsapp.handleInbound({ from: phone, text: "0123456789", toPhoneNumberId: PLATFORM });
    await app.whatsapp.handleInbound({ from: phone, text: "2", toPhoneNumberId: PLATFORM });

    const merchant = await app.repos.merchants.byPhone(phone);
    expect(merchant!.slug).toBe("circuitcity2");
  });

  it("still accepts the raw id, so links already shared keep working", async () => {
    const app = makeApp();
    const shop = await seedMerchant(app, { businessName: "Circuit City", slug: "circuitcity" });
    await seedProduct(app, shop.id);
    const reply = await app.whatsapp.handleInbound({
      from: "+2348090005050", text: `shop-${shop.id}`, toPhoneNumberId: PLATFORM,
    });
    expect(reply).toContain("Circuit City");
  });
});
