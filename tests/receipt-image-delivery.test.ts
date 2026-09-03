import { describe, it, expect } from "vitest";
import { NotificationService } from "../src/modules/notification/notification-service.js";
import { CaptureTransport, type SendOptions } from "../src/modules/notification/transport.js";
import { createInMemoryRepositories } from "../src/db/memory/in-memory-repositories.js";
import { InMemoryMetrics } from "../src/modules/metrics/metrics.js";

const URLS = {
  buyerBaseUrl: "https://pay.userhodium.xyz",
  merchantBaseUrl: "https://app.userhodium.xyz",
};

async function fixture() {
  const repos = createInMemoryRepositories();
  const merchant = await repos.merchants.create({
    id: "mch_r", phone: "+2349110461379", businessName: "Circuit City",
    status: "active", kycState: "verified", cryptoEnabled: false,
  });
  const product = await repos.products.create({
    id: "prod_r", merchantId: merchant.id, name: "Test Item A", price: 10_000,
  });
  const order = await repos.orders.create({
    id: "ord_receipt_img", merchantId: merchant.id, buyerRef: "+2349032621846",
    items: [{ productId: product.id, name: product.name, unitPrice: product.price, qty: 1 }],
    amount: 10_000, rail: "fiat", status: "paid",
  });
  return { repos, merchant, order };
}

describe("receipt image delivery", () => {
  it("attaches the rendered receipt to the buyer's message", async () => {
    const { repos, merchant, order } = await fixture();
    const ch = new CaptureTransport("whatsapp");
    const svc = new NotificationService(repos, [ch], new InMemoryMetrics(), URLS);

    await svc.sendReceiptToBuyer({
      merchantId: merchant.id, orderId: order.id,
      buyerRef: order.buyerRef, amount: order.amount,
    });

    const sent = ch.sent.at(-1)!;
    expect(sent.imageUrl).toBe(`https://pay.userhodium.xyz/api/receipt/${order.id}/image.png`);
    // The picture carries the text as its CAPTION — one message, so the buyer
    // sees proof of payment without tapping anything, and the link is still
    // there to copy.
    expect(sent.message).toContain("Receipt from Circuit City");
    expect(sent.message).toContain(`/receipt/${order.id}`);
  });

  it("attaches it to the merchant's confirmation too", async () => {
    const { repos, merchant, order } = await fixture();
    const ch = new CaptureTransport("whatsapp");
    const svc = new NotificationService(repos, [ch], new InMemoryMetrics(), URLS);

    await svc.notifyMerchantPaid({
      merchantId: merchant.id, orderId: order.id, amount: order.amount,
    });

    const sent = ch.sent.at(-1)!;
    expect(sent.imageUrl).toContain(`/api/receipt/${order.id}/image.png`);
    expect(sent.message).toContain("You've been paid");
  });

  it("still delivers the text when the image cannot be sent", async () => {
    const { repos, merchant, order } = await fixture();
    // Meta fetches the image URL itself; on a sleeping free tier that fetch can
    // time out. A receipt must not vanish because a picture failed to attach.
    class ImageFails extends CaptureTransport {
      async sendImage(): Promise<{ ok: boolean }> {
        return { ok: false };
      }
    }
    const ch = new ImageFails("whatsapp");
    const svc = new NotificationService(repos, [ch], new InMemoryMetrics(), URLS);

    await svc.sendReceiptToBuyer({
      merchantId: merchant.id, orderId: order.id,
      buyerRef: order.buyerRef, amount: order.amount,
    });

    const sent = ch.sent.at(-1)!;
    expect(sent.imageUrl).toBeUndefined();       // fell back to plain text
    expect(sent.message).toContain("Receipt from Circuit City");
  });

  it("sends plain text on a channel that cannot do images at all", async () => {
    const { repos, merchant, order } = await fixture();
    class TextOnly extends CaptureTransport {
      sendImage = undefined as unknown as undefined; // e.g. SMS or email
    }
    const ch = new TextOnly("sms");
    const svc = new NotificationService(repos, [ch], new InMemoryMetrics(), URLS);

    await svc.sendReceiptToBuyer({
      merchantId: merchant.id, orderId: order.id,
      buyerRef: order.buyerRef, amount: order.amount,
    });
    expect(ch.sent.at(-1)!.message).toContain("Total paid");
  });
});
