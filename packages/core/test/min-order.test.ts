import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createDiscount, createGiftCardProduct, createProduct, createShop, DemoModel, exportStore, importStore, quoteCart, setMinOrder, signUp, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const austin = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shopId = (await f.shop()).id;
  const sticker = await createProduct(f.db, shopId, { title: "Sticker", status: "active", variants: [{ title: "Default", priceMinor: 400, stock: 50 }] });
  const [variant] = await f.variants(sticker.id);
  await setMinOrder(f.db, shopId, 1500);
  const stickers = (quantity: number) => [{ variantId: variant!.id, quantity }];
  const checkout = async (quantity: number, opts: { storefront?: boolean; discountCode?: string } = {}) =>
    startCheckout(f.db, f.payments, await f.shop(), { email: "buyer@example.com", address: austin, lines: stickers(quantity), storefront: opts.storefront ?? true, discountCode: opts.discountCode });
  return { ...f, shopId, stickers, checkout };
}

describe("smallest order", () => {
  it("says how much more a small cart needs, and checkout waits until it gets there", async () => {
    const f = await setup();
    expect((await quoteCart(f.db, await f.shop(), f.stickers(2))).minimumOrder).toEqual({ minMinor: 1500, shortByMinor: 700 });
    await expect(f.checkout(2)).rejects.toThrow(/takes orders of \$15\.00 or more\. Add \$7\.00 more to check out\./);
    expect((await quoteCart(f.db, await f.shop(), f.stickers(4))).minimumOrder).toEqual({ minMinor: 1500, shortByMinor: 0 });
    expect((await f.checkout(4)).order.subtotalMinor).toBe(1600);
  });

  it("counts goods after discounts, and leaves out payment links, gift cards alone and stores without one", async () => {
    const f = await setup();
    await createDiscount(f.db, f.shopId, { code: "HALF", kind: "percent", value: 50 });
    await expect(f.checkout(4, { discountCode: "HALF" })).rejects.toThrow("Add $7.00 more");
    // A payment link the merchant built isn't the store's own checkout.
    expect((await f.checkout(2, { storefront: false })).order.subtotalMinor).toBe(800);
    const card = await createGiftCardProduct(f.db, await f.shop(), [1000]);
    const [cardVariant] = await f.variants(card.id);
    expect((await quoteCart(f.db, await f.shop(), [{ variantId: cardVariant!.id, quantity: 1 }])).minimumOrder).toBeNull();
    await setMinOrder(f.db, f.shopId, 0);
    expect((await quoteCart(f.db, await f.shop(), f.stickers(1))).minimumOrder).toBeNull();
    expect((await f.checkout(1)).order.subtotalMinor).toBe(400);
  });

  it("checks the amount and moves with the store", async () => {
    const f = await setup();
    await expect(setMinOrder(f.db, f.shopId, -1)).rejects.toThrow("between 0 and 1,000");
    await expect(setMinOrder(f.db, f.shopId, 100_001)).rejects.toThrow("between 0 and 1,000");
    const file = JSON.parse(JSON.stringify(await exportStore(f.db, f.shopId)));
    expect(file.store.min_order_minor).toBe(1500);
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, file);
    expect((await f.db.query.shops.findFirst({ where: eq(schema.shops.id, copy.id) }))!.minOrderMinor).toBe(1500);
  });
});
