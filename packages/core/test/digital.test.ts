import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  cleanFileName, createProduct, DemoModel, digitalFileFor, DOWNLOADS_PER_ITEM, handlePaymentEvent, onOrderPaid, orderDownloads, quoteCart, refundOrder,
  removeDigitalFile, resetDownloads, setDigitalFile, startCheckout, takeDownload,
} from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
const pdf = Buffer.from("%PDF-1.4 a little guide");

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  const guide = await createProduct(f.db, shop.id, { title: "Lamp Styling Guide", status: "active", variants: [{ priceMinor: 900 }] });
  const [guideVariant] = await f.variants(guide.id);
  const [lamp] = await f.variants(f.products.lamp.id);
  async function buy(lines: { variantId: string; quantity: number }[]) {
    const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email: "ada@example.com", address, lines });
    const { body, signature } = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    await onOrderPaid(f.ctx, order.id);
    return (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
  }
  return { ...f, shop, guide, guideVariant: guideVariant!, lamp: lamp!, buy };
}

describe("digital downloads", () => {
  it("a file makes a product a download: no shipping, delivered by link, a few downloads per item", async () => {
    const f = await setup();
    await expect(setDigitalFile(f.db, f.shop.id, f.products.lamp.id, { name: "x.pdf", data: pdf })).rejects.toThrow("comes from a supplier");
    await expect(setDigitalFile(f.db, f.shop.id, f.guide.id, { name: "x.pdf", data: Buffer.alloc(0) })).rejects.toThrow("Pick a file");
    await expect(setDigitalFile(f.db, f.shop.id, f.guide.id, { name: "x.pdf", data: Buffer.alloc(8 * 1024 * 1024 + 1) })).rejects.toThrow("up to 8 MB");
    const file = await setDigitalFile(f.db, f.shop.id, f.guide.id, { name: "C:\\Users\\me\\Styling Guide.pdf", contentType: "application/pdf", data: pdf });
    expect(file).toMatchObject({ name: "Styling Guide.pdf", bytes: pdf.length });

    // On its own it needs no shipping; with the lamp, only the lamp ships.
    const alone = await quoteCart(f.db, f.shop, [{ variantId: f.guideVariant.id, quantity: 1 }], { country: "US" });
    expect(alone).toMatchObject({ needsShipping: false, shippingMinor: 0, shipping: null });
    const mixed = await quoteCart(f.db, f.shop, [{ variantId: f.guideVariant.id, quantity: 1 }, { variantId: f.lamp.id, quantity: 1 }], { country: "US" });
    expect(mixed.needsShipping).toBe(true);
    expect(mixed.shippingMinor).toBe((await quoteCart(f.db, f.shop, [{ variantId: f.lamp.id, quantity: 1 }], { country: "US" })).shippingMinor);

    const order = await f.buy([{ variantId: f.guideVariant.id, quantity: 2 }]);
    expect(order.fulfillmentStatus).toBe("delivered");
    const [download] = await orderDownloads(f.db, order.id);
    expect(download).toMatchObject({ title: "Lamp Styling Guide", fileName: "Styling Guide.pdf", used: 0, allowed: 2 * DOWNLOADS_PER_ITEM });
    const mail = f.mailer.sent.find((m) => m.subject === `Order #${order.number} confirmed`)!;
    expect(mail.text).toContain(`/orders/${order.paymentIntentId}/download/${download!.lineId}`);
    expect(mail.text).toContain("There's nothing to ship.");

    const got = await takeDownload(f.db, f.shop.id, order.paymentIntentId!, download!.lineId);
    expect(got.data.equals(pdf)).toBe(true);
    expect(got.left).toBe(2 * DOWNLOADS_PER_ITEM - 1);
    await expect(takeDownload(f.db, f.shop.id, "pi_wrong", download!.lineId)).rejects.toThrow();
    for (let i = 1; i < 2 * DOWNLOADS_PER_ITEM; i++) await takeDownload(f.db, f.shop.id, order.paymentIntentId!, download!.lineId);
    await expect(takeDownload(f.db, f.shop.id, order.paymentIntentId!, download!.lineId)).rejects.toThrow("the most for this order");
    expect(await resetDownloads(f.db, f.shop.id, order.id)).toBe(1);
    expect((await takeDownload(f.db, f.shop.id, order.paymentIntentId!, download!.lineId)).left).toBe(2 * DOWNLOADS_PER_ITEM - 1);

    // A refund closes the download.
    await refundOrder(f.ctx, f.shop.id, order.id, {});
    await expect(takeDownload(f.db, f.shop.id, order.paymentIntentId!, download!.lineId)).rejects.toThrow("refunded");
  });

  it("an order with a download and a parcel still ships the parcel", async () => {
    const f = await setup();
    await setDigitalFile(f.db, f.shop.id, f.guide.id, { name: "guide.pdf", data: pdf });
    const order = await f.buy([{ variantId: f.guideVariant.id, quantity: 1 }, { variantId: f.lamp.id, quantity: 1 }]);
    expect(order.fulfillmentStatus).not.toBe("delivered");
    expect(await orderDownloads(f.db, order.id)).toHaveLength(1);
    const mail = f.mailer.sent.find((m) => m.subject === `Order #${order.number} confirmed`)!;
    expect(mail.text).toContain("Your download");
    expect(mail.text).not.toContain("There's nothing to ship.");

    // Taking the file off makes it a normal product again.
    await removeDigitalFile(f.db, f.shop.id, f.guide.id);
    expect(await digitalFileFor(f.db, f.guide.id)).toBeNull();
    expect((await quoteCart(f.db, f.shop, [{ variantId: f.guideVariant.id, quantity: 1 }], { country: "US" })).needsShipping).toBe(true);
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName('a"b\u0007.zip')).toBe("ab.zip");
  });
});
