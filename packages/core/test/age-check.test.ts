import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createProduct, DemoModel, exportStore, importStore, quoteCart, setMinAge, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("age check", () => {
  it("asks buyers on the store's checkout to confirm they're old enough, and keeps what they confirmed", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const wine = await createProduct(f.db, shop.id, { title: "Red Wine", status: "active", variants: [{ priceMinor: 1800, stock: 10 }] });
    const knife = await createProduct(f.db, shop.id, { title: "Pocket Knife", status: "active", variants: [{ priceMinor: 2500, stock: 10 }] });
    await expect(setMinAge(f.db, shop.id, wine.id, 12)).rejects.toThrow("from 13 to 25");
    await expect(setMinAge(f.db, shop.id, wine.id, 18.5)).rejects.toThrow("from 13 to 25");
    expect(await setMinAge(f.db, shop.id, wine.id, 21)).toEqual({ minAge: 21 });
    await setMinAge(f.db, shop.id, knife.id, 18);
    const [w] = await f.variants(wine.id);
    const [k] = await f.variants(knife.id);
    const [lamp] = await f.variants(f.products.lamp.id);
    const lines = [{ variantId: k!.id, quantity: 1 }, { variantId: w!.id, quantity: 1 }];

    // The highest age in the cart is the one asked for.
    expect((await quoteCart(f.db, shop, lines)).minAge).toBe(21);
    expect((await quoteCart(f.db, shop, [{ variantId: lamp!.id, quantity: 1 }])).minAge).toBeNull();

    await expect(startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address, lines, storefront: true })).rejects.toThrow("Confirm you're 21 or older to buy Red Wine.");
    const { order } = await startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address, lines, storefront: true, ageConfirmed: true });
    expect(order.ageConfirmed).toBe(21);
    // Nothing restricted: nothing to confirm, and nothing kept even if ticked.
    const { order: plain } = await startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address, lines: [{ variantId: lamp!.id, quantity: 1 }], storefront: true, ageConfirmed: true });
    expect(plain.ageConfirmed).toBeNull();
    // A payment link the merchant builds doesn't ask.
    const { order: link } = await startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address, lines });
    expect(link.ageConfirmed).toBeNull();

    await setMinAge(f.db, shop.id, wine.id, null);
    expect((await quoteCart(f.db, shop, lines)).minAge).toBe(18);
  });

  it("goes along when the store is copied", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const wine = await createProduct(f.db, shop.id, { title: "Red Wine", status: "active", variants: [{ priceMinor: 1800 }] });
    await setMinAge(f.db, shop.id, wine.id, 18);
    const data = await exportStore(f.db, shop.id);
    const g = await makeFixture(new DemoModel());
    const target = await g.shop();
    await g.db.delete(schema.products).where(eq(schema.products.shopId, target.id));
    await importStore(g.db, target.id, data);
    const copied = await g.db.query.products.findFirst({ where: eq(schema.products.handle, wine.handle) });
    expect(copied!.minAge).toBe(18);
  });
});
