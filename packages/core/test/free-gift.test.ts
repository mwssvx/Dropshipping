import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createDiscount, createGiftCardProduct, createProduct, createShop, DemoModel, exportStore, freeGiftChoices, handlePaymentEvent, importStore, onOrderPaid, quoteCart, setFreeGift, signUp, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const austin = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shopId = (await f.shop()).id;
  const mug = await createProduct(f.db, shopId, { title: "Mug", status: "active", variants: [{ title: "Default", priceMinor: 1500, stock: 9 }] });
  const tote = await createProduct(f.db, shopId, { title: "Tote bag", status: "active", variants: [{ title: "Natural", priceMinor: 1200, costMinor: 300, stock: 2 }] });
  const [mugVariant] = await f.variants(mug.id);
  const [toteVariant] = await f.variants(tote.id);
  await setFreeGift(f.db, shopId, { variantId: toteVariant!.id, minSubtotalMinor: 4000 });
  const mugs = (quantity: number) => [{ variantId: mugVariant!.id, quantity }];
  async function pay(orderId: string) {
    const order = (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) }))!;
    const { body, signature } = f.payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor });
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    await onOrderPaid(f.ctx, order.id);
  }
  return { ...f, shopId, mug, tote, toteVariant: toteVariant!, mugs, pay };
}

describe("free gift", () => {
  it("tells the cart how much more it takes, then adds the gift to the order for free", async () => {
    const f = await setup();
    const short = await quoteCart(f.db, await f.shop(), f.mugs(1));
    expect(short.freeGift).toMatchObject({ title: "Tote bag – Natural", unlocked: false, moreMinor: 2500 });

    const quote = await quoteCart(f.db, await f.shop(), f.mugs(3));
    expect(quote.freeGift).toMatchObject({ unlocked: true, moreMinor: 0 });
    // It costs the buyer nothing.
    expect(quote.subtotalMinor).toBe(4500);

    const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email: "buyer@example.com", address: austin, lines: f.mugs(3) });
    expect(order.subtotalMinor).toBe(4500);
    const lines = await f.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
    expect(lines.find((l) => l.variantId === f.toteVariant.id)).toMatchObject({ title: "Tote bag – Natural (free gift)", quantity: 1, unitPriceMinor: 0, unitCostMinor: 300 });

    // It's the store's own stock, so it counts down when the order is paid.
    await f.pay(order.id);
    expect((await f.db.query.variants.findFirst({ where: eq(schema.variants.id, f.toteVariant.id) }))!.stock).toBe(1);
  });

  it("goes by what's paid after discounts, and isn't offered when it can't be given", async () => {
    const f = await setup();
    await createDiscount(f.db, f.shopId, { code: "HALF", kind: "percent", value: 50 });
    const discounted = await quoteCart(f.db, await f.shop(), f.mugs(3), { discountCode: "HALF" });
    expect(discounted.freeGift).toMatchObject({ unlocked: false, moreMinor: 1750 });
    const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email: "buyer@example.com", address: austin, lines: f.mugs(3), discountCode: "HALF" });
    const lines = await f.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
    expect(lines.map((l) => l.title)).toEqual(["Mug"]);

    // Not to a country the gift can't go to.
    await f.db.update(schema.products).set({ blockedCountries: ["CA"] }).where(eq(schema.products.id, f.tote.id));
    expect((await quoteCart(f.db, await f.shop(), f.mugs(3), { country: "CA" })).freeGift).toBeNull();
    expect((await quoteCart(f.db, await f.shop(), f.mugs(3), { country: "US" })).freeGift).not.toBeNull();
    // Not once it's sold out, or off sale.
    await f.db.update(schema.variants).set({ stock: 0 }).where(eq(schema.variants.id, f.toteVariant.id));
    expect((await quoteCart(f.db, await f.shop(), f.mugs(3))).freeGift).toBeNull();
    await f.db.update(schema.variants).set({ stock: 5 }).where(eq(schema.variants.id, f.toteVariant.id));
    await f.db.update(schema.products).set({ status: "draft" }).where(eq(schema.products.id, f.tote.id));
    expect((await quoteCart(f.db, await f.shop(), f.mugs(3))).freeGift).toBeNull();
    // Off.
    await f.db.update(schema.products).set({ status: "active" }).where(eq(schema.products.id, f.tote.id));
    await setFreeGift(f.db, f.shopId, null);
    expect((await quoteCart(f.db, await f.shop(), f.mugs(3))).freeGift).toBeNull();
  });

  it("checks the gift and the amount, and moves with the store", async () => {
    const f = await setup();
    await expect(setFreeGift(f.db, f.shopId, { variantId: f.toteVariant.id, minSubtotalMinor: 0 })).rejects.toThrow("between 0.01 and 10,000");
    const card = await createGiftCardProduct(f.db, await f.shop(), [2500]);
    const [cardVariant] = await f.variants(card.id);
    const choices = (await freeGiftChoices(f.db, f.shopId)).map((c) => c.title);
    expect(choices).toContain("Tote bag – Natural");
    expect(choices.some((c) => c.startsWith(card.title))).toBe(false);
    await expect(setFreeGift(f.db, f.shopId, { variantId: cardVariant!.id, minSubtotalMinor: 4000 })).rejects.toThrow("Pick a product");

    const file = JSON.parse(JSON.stringify(await exportStore(f.db, f.shopId)));
    expect(file.free_gift).toEqual({ product: f.tote.handle, option: "Natural", min_subtotal_minor: 4000 });
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, file);
    const copied = (await f.db.query.shops.findFirst({ where: eq(schema.shops.id, copy.id) }))!.freeGift!;
    const option = await f.db.query.variants.findFirst({ where: eq(schema.variants.id, copied.variantId) });
    expect(option!.title).toBe("Natural");
    expect(copied.minSubtotalMinor).toBe(4000);
  });
});
