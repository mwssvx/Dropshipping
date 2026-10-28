import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createCollection, createDiscount, createShop, DemoModel, deleteCollection, describeDiscount, exportStore, importStore, productOffers, quoteCart, signUp, startCheckout, updateCollection } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  const { lamp, projector } = f.products;
  const [lampV] = await f.variants(lamp.id);
  const [projV] = await f.variants(projector.id);
  return { ...f, shop, lamp, projector, lampV: lampV!, projV: projV! };
}

describe("codes for a collection", () => {
  it("take money off what's in the collection at checkout, including products added later", async () => {
    const f = await setup();
    const summer = await createCollection(f.db, f.shop.id, { title: "Summer", productIds: [f.lamp.id] });
    await expect(createDiscount(f.db, f.shop.id, { code: "BOTH", kind: "percent", value: 10, collectionId: summer.id, productIds: [f.lamp.id] })).rejects.toThrow("not both");
    await expect(createDiscount(f.db, f.shop.id, { code: "SUMSHIP", kind: "free_shipping", collectionId: summer.id })).rejects.toThrow("Free shipping is for the whole order");
    await expect(createDiscount(f.db, f.shop.id, { code: "SUMAUTO", kind: "percent", value: 10, automatic: true, minSubtotalMinor: 1000, collectionId: summer.id })).rejects.toThrow("Give it a code");
    await expect(createDiscount(f.db, f.shop.id, { code: "NOPE", kind: "percent", value: 10, collectionId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow("Collection");
    const d = await createDiscount(f.db, f.shop.id, { code: "SUMMER20", kind: "percent", value: 20, collectionId: summer.id });
    expect(describeDiscount({ ...d, collectionTitle: "Summer" }, "USD")).toBe("20% off Summer");

    const both = [{ variantId: f.lampV.id, quantity: 1 }, { variantId: f.projV.id, quantity: 1 }];
    const q = await quoteCart(f.db, f.shop, both, { discountCode: "summer20", country: "US" });
    expect(q.discountMinor).toBe(Math.floor(f.lampV.priceMinor * 0.2));
    expect(q.discount?.label).toBe("20% off Summer");
    await expect(quoteCart(f.db, f.shop, [{ variantId: f.projV.id, quantity: 1 }], { discountCode: "SUMMER20", country: "US" })).rejects.toThrow("SUMMER20 is for Summer, and nothing from it is in your cart");

    // The projector joins the collection, and the same code now covers it too.
    await updateCollection(f.db, f.shop.id, summer.id, { title: "Summer", productIds: [f.lamp.id, f.projector.id] });
    const q2 = await quoteCart(f.db, f.shop, both, { discountCode: "SUMMER20", country: "US" });
    expect(q2.discountMinor).toBe(Math.floor((f.lampV.priceMinor + f.projV.priceMinor) * 0.2));
    const { order } = await startCheckout(f.db, f.payments, f.shop, { email: "ada@example.com", address, lines: both, discountCode: "SUMMER20" });
    expect(order.discountMinor).toBe(q2.discountMinor);

    // An empty or deleted collection never turns it into a code for everything.
    await updateCollection(f.db, f.shop.id, summer.id, { title: "Summer", productIds: [] });
    await expect(quoteCart(f.db, f.shop, both, { discountCode: "SUMMER20", country: "US" })).rejects.toThrow("isn't a valid code");
    await deleteCollection(f.db, f.shop.id, summer.id);
    await expect(quoteCart(f.db, f.shop, both, { discountCode: "SUMMER20", country: "US" })).rejects.toThrow("isn't a valid code");
  });

  it("work with collections that fill themselves, and with buy X get Y", async () => {
    const f = await setup();
    await f.db.update(schema.products).set({ tags: ["summer"] }).where(eq(schema.products.id, f.lamp.id));
    const auto = await createCollection(f.db, f.shop.id, { title: "Tagged summer", rules: { match: "all", sort: "title", conditions: [{ kind: "tagged", tag: "summer" }] } });
    await createDiscount(f.db, f.shop.id, { code: "TWOFORONE", kind: "bxgy", value: 100, buyQty: 1, getQty: 1, automatic: true, collectionId: auto.id });
    expect(await productOffers(f.db, f.shop, f.lamp.id)).toEqual(["Buy 1, get 1 free"]);
    expect(await productOffers(f.db, f.shop, f.projector.id)).toEqual([]);
    // Two projectors don't count; two lamps do.
    expect((await quoteCart(f.db, f.shop, [{ variantId: f.projV.id, quantity: 2 }], { country: "US" })).discountMinor).toBe(0);
    const q = await quoteCart(f.db, f.shop, [{ variantId: f.lampV.id, quantity: 2 }, { variantId: f.projV.id, quantity: 2 }], { country: "US" });
    expect(q.discountMinor).toBe(f.lampV.priceMinor);
    expect(q.discount?.label).toBe("Buy 1, get 1 free from Tagged summer");
  });

  it("travel in store files with their collection", async () => {
    const f = await setup();
    const summer = await createCollection(f.db, f.shop.id, { title: "Summer", productIds: [f.lamp.id] });
    const gone = await createCollection(f.db, f.shop.id, { title: "Gone", productIds: [f.lamp.id] });
    await createDiscount(f.db, f.shop.id, { code: "SUMMER20", kind: "percent", value: 20, collectionId: summer.id });
    await createDiscount(f.db, f.shop.id, { code: "GONE10", kind: "percent", value: 10, collectionId: gone.id });
    await deleteCollection(f.db, f.shop.id, gone.id);
    const file = await exportStore(f.db, f.shop.id);
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, file);
    const codes = await f.db.query.discounts.findMany({ where: eq(schema.discounts.shopId, copy.id) });
    const newSummer = await f.db.query.collections.findFirst({ where: eq(schema.collections.shopId, copy.id) });
    expect(codes.map((c) => [c.code, c.collectionId])).toEqual([["SUMMER20", newSummer!.id]]);
  });
});
