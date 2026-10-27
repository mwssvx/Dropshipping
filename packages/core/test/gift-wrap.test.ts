import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { buyerAmounts, createProduct, DemoModel, handlePaymentEvent, invoiceDocument, onOrderPaid, orderDocuments, ordersCsv, packingSlips, setGiftWrap, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const austin = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shopId = (await f.shop()).id;
  const mug = await createProduct(f.db, shopId, { title: "Mug", status: "active", variants: [{ title: "Default", priceMinor: 1500, stock: 9 }] });
  const [mugVariant] = await f.variants(mug.id);
  await setGiftWrap(f.db, shopId, { priceMinor: 450, note: " Kraft paper and a ribbon " });
  async function checkout(opts: { gift?: boolean; giftWrap?: boolean } = {}) {
    return startCheckout(f.db, f.payments, await f.shop(), {
      email: "buyer@example.com",
      address: austin,
      lines: [{ variantId: mugVariant!.id, quantity: 1 }],
      gift: opts.gift ? { from: "Grace", message: "Happy birthday" } : null,
      giftWrap: opts.giftWrap,
    });
  }
  async function pay(orderId: string) {
    const order = (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) }))!;
    const { body, signature } = f.payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor });
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    await onOrderPaid(f.ctx, order.id);
    return (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
  }
  return { ...f, shopId, checkout, pay };
}

describe("gift wrapping", () => {
  it("adds the store's price to a gift when the buyer asks, and shows on the receipt, invoice, slip and export", async () => {
    const f = await setup();
    expect((await f.shop()).giftWrap).toEqual({ priceMinor: 450, note: "Kraft paper and a ribbon" });
    const plain = (await f.checkout({ gift: true })).order;
    expect(plain.giftWrapMinor).toBe(0);
    // Only gifts get wrapped.
    expect((await f.checkout({ giftWrap: true })).order.giftWrapMinor).toBe(0);

    const { order, quote } = await f.checkout({ gift: true, giftWrap: true });
    expect(order.giftWrapMinor).toBe(450);
    expect(order.totalMinor).toBe(plain.totalMinor + 450);
    expect(quote.totalMinor).toBe(order.totalMinor);
    expect(buyerAmounts(order).giftWrapMinor).toBe(450);

    const paid = await f.pay(order.id);
    expect(f.mailer.sent.find((m) => m.subject === `Order #${paid.number} confirmed`)!.text).toContain("Includes gift wrapping: $4.50");
    const doc = await invoiceDocument(f.db, f.shopId, (await orderDocuments(f.db, paid.id))[0]!.id);
    expect(doc.giftWrapMinor).toBe(450);
    expect((await packingSlips(f.db, f.shopId, { orderId: paid.id })).slips[0]!.giftWrap).toBe(true);
    const [head, ...rows] = (await ordersCsv(f.db, f.shopId)).trim().split("\n");
    const col = head!.split(",").indexOf("Gift wrap");
    expect(rows.map((r) => r.split(",")[col])).toContain("4.50");
  });

  it("is off unless the store wraps, and checks the price", async () => {
    const f = await setup();
    await setGiftWrap(f.db, f.shopId, null);
    expect((await f.checkout({ gift: true, giftWrap: true })).order.giftWrapMinor).toBe(0);
    await expect(setGiftWrap(f.db, f.shopId, { priceMinor: -5 })).rejects.toThrow("between 0 and 100");
    await expect(setGiftWrap(f.db, f.shopId, { priceMinor: 100, note: "x".repeat(121) })).rejects.toThrow("under 120");
    expect(await setGiftWrap(f.db, f.shopId, { priceMinor: 0, note: "" })).toEqual({ priceMinor: 0, note: null });
  });
});
