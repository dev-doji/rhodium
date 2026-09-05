import { describe, it, expect } from "vitest";
import { makeApp, seedMerchant } from "./helpers/harness.js";
import { MediaFetcher } from "../src/modules/whatsapp/media.js";

/**
 * A vendor photographs a thing right after naming it. Tees Kitchen added a
 * product and had no way to put a picture on it, so her storefront showed a
 * placeholder — which is what a buyer decides against.
 */

/** Meta's two-step media fetch: id -> signed url -> bytes. */
function metaMedia(bytes: Buffer, mime = "image/jpeg", fileSize?: number): typeof fetch {
  return (async (url: string) => {
    if (String(url).includes("/signed")) {
      return new Response(bytes, { status: 200 });
    }
    return new Response(
      JSON.stringify({ url: "https://lookaside.fb/signed", mime_type: mime, file_size: fileSize }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

describe("fetching a photo from WhatsApp", () => {
  it("resolves the media id, then downloads with the token", async () => {
    const calls: string[] = [];
    const spy = (async (url: string, init: RequestInit) => {
      calls.push(String(url));
      // The signed URL still needs the bearer token; without it Meta returns
      // an HTML error page that would otherwise be stored as a "photo".
      expect((init.headers as Record<string, string>).Authorization).toContain("Bearer");
      return metaMedia(PHOTO)(url as never, init as never);
    }) as unknown as typeof fetch;

    const got = await new MediaFetcher({ accessToken: "tok" }, spy).fetch("media_1");
    expect(got?.bytes.length).toBe(PHOTO.length);
    expect(got?.contentType).toBe("image/jpeg");
    expect(calls).toHaveLength(2);
  });

  it("refuses a file too large to serve to every buyer", async () => {
    const big = await new MediaFetcher({ accessToken: "t" }, metaMedia(PHOTO, "image/jpeg", 9_000_000))
      .fetch("m");
    expect(big).toBeNull();
  });

  it("refuses anything that is not an image", async () => {
    const pdf = await new MediaFetcher({ accessToken: "t" }, metaMedia(PHOTO, "application/pdf")).fetch("m");
    expect(pdf).toBeNull();
  });

  it("returns null rather than throwing, so a bad photo cannot lose a product", async () => {
    const dead = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    await expect(new MediaFetcher({ accessToken: "t" }, dead).fetch("m")).resolves.toBeNull();
  });
});

describe("adding a photo to a product over WhatsApp", () => {
  const send = (app: ReturnType<typeof makeApp>, from: string, image: { mediaId: string }) =>
    app.whatsapp.handleInbound({ from, text: "", image });

  it("attaches the photo to the product just added", async () => {
    const app = makeApp();
    const m = await seedMerchant(app, { phone: "+2348051110001" });
    (app.whatsapp as unknown as { media: MediaFetcher }).media = new MediaFetcher(
      { accessToken: "t" },
      metaMedia(PHOTO),
    );

    const added = await app.whatsapp.handleInbound({ from: m.phone, text: "add Egusi Soup 3000" });
    // She should be told to send one, not left to guess it is possible.
    expect(added).toMatch(/send a photo/i);

    const reply = await send(app, m.phone, { mediaId: "media_1" });
    expect(reply).toMatch(/Egusi Soup/);

    const products = await app.repos.products.listByMerchant(m.id);
    expect(products[0]!.imageUrl).toBeTruthy();
  });

  it("falls back to her newest product without one", async () => {
    const app = makeApp();
    const m = await seedMerchant(app, { phone: "+2348051110002" });
    (app.whatsapp as unknown as { media: MediaFetcher }).media = new MediaFetcher(
      { accessToken: "t" },
      metaMedia(PHOTO),
    );
    await app.whatsapp.handleInbound({ from: m.phone, text: "add Rice 2000" });
    // A different message in between clears the "expecting a photo" hint; the
    // picture should still land somewhere sensible rather than being dropped.
    (app.whatsapp as unknown as { awaitingPhoto: Map<string, unknown> }).awaitingPhoto.clear();

    const reply = await send(app, m.phone, { mediaId: "media_1" });
    expect(reply).toMatch(/Rice/);
    expect((await app.repos.products.listByMerchant(m.id))[0]!.imageUrl).toBeTruthy();
  });

  it("says so plainly when there is no product to attach to", async () => {
    const app = makeApp();
    const m = await seedMerchant(app, { phone: "+2348051110003" });
    (app.whatsapp as unknown as { media: MediaFetcher }).media = new MediaFetcher(
      { accessToken: "t" },
      metaMedia(PHOTO),
    );
    const reply = await send(app, m.phone, { mediaId: "media_1" });
    expect(reply).toMatch(/add the product first/i);
  });

  it("keeps the product when the photo cannot be saved", async () => {
    const app = makeApp();
    const m = await seedMerchant(app, { phone: "+2348051110004" });
    const dead = (async () => { throw new Error("nope"); }) as unknown as typeof fetch;
    (app.whatsapp as unknown as { media: MediaFetcher }).media = new MediaFetcher(
      { accessToken: "t" },
      dead,
    );
    await app.whatsapp.handleInbound({ from: m.phone, text: "add Yam 1500" });
    const reply = await send(app, m.phone, { mediaId: "media_1" });

    expect(reply).toMatch(/couldn't save/i);
    // The product survives — a failed picture must not cost her the listing.
    const products = await app.repos.products.listByMerchant(m.id);
    expect(products).toHaveLength(1);
    expect(products[0]!.imageUrl).toBeFalsy();
  });

  it("ignores a photo from a buyer, which is not a product picture", async () => {
    const app = makeApp();
    const m = await seedMerchant(app, { phone: "+2348051110005" });
    (app.whatsapp as unknown as { media: MediaFetcher }).media = new MediaFetcher(
      { accessToken: "t" },
      metaMedia(PHOTO),
    );
    await app.whatsapp.handleInbound({ from: m.phone, text: "add Beans 900" });
    const reply = await send(app, "+2349990001111", { mediaId: "media_1" });
    expect(reply).not.toMatch(/Photo added/i);
    expect((await app.repos.products.listByMerchant(m.id))[0]!.imageUrl).toBeFalsy();
  });
});
