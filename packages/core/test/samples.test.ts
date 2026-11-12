import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, schema } from "@sf/db";
import { createProduct, createShop, DEMO_SUPPLIER_LINKS, FakeSupplier, importProduct, listSamples, orderSample, signUp, suppliersFrom, UserError } from "../src";

const DAY = 86_400_000;
const home = { name: "Ada Owner", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("samples", () => {
  it("orders one to the merchant's door, follows its tracking, and isn't a sale", async () => {
    let clock = Date.parse("2026-11-12T10:00:00Z");
    const supplier = new FakeSupplier({ shipAfterMs: DAY, deliverAfterMs: 5 * DAY, now: () => clock });
    const suppliers = suppliersFrom([supplier]);
    const db = await createTestDb();
    const user = await signUp(db, { email: "owner@example.com", password: "correct horse" });
    const shop = await createShop(db, user.id, { name: "Glow Lamps", country: "US" });
    const product = await importProduct(db, suppliers, shop.id, { url: DEMO_SUPPLIER_LINKS[0]!, title: "Sunset lamp", prices: {}, publish: true });
    const variant = (await db.query.variants.findFirst({ where: eq(schema.variants.productId, product.id) }))!;

    const sample = await orderSample(db, suppliers, shop, { variantId: variant.id, email: "owner@example.com", address: home });
    expect(sample).toMatchObject({ status: "placed", productId: product.id, title: expect.stringContaining("Sunset lamp") });
    expect(supplier.placed.at(-1)).toMatchObject({ reference: `sample_${sample.id}`, address: { city: "Austin" }, lines: [{ variantRef: variant.supplierVariantRef, quantity: 1 }] });
    expect(await db.query.orders.findMany({ where: eq(schema.orders.shopId, shop.id) })).toHaveLength(0);

    clock += 2 * DAY;
    expect((await listSamples(db, suppliers, shop.id, product.id))[0]).toMatchObject({ status: "shipped", carrier: "Demo Post", trackingNumber: expect.stringMatching(/^DS/) });
    clock += 5 * DAY;
    expect((await listSamples(db, suppliers, shop.id, product.id))[0]).toMatchObject({ status: "delivered" });

    // At most three per product; a supplier refusal is kept with its reason and doesn't count.
    await expect(orderSample(db, suppliers, shop, { variantId: variant.id, email: "o@x", address: { ...home, country: "ZZ" } })).rejects.toThrow("The sample wasn't ordered");
    expect((await listSamples(db, suppliers, shop.id, product.id))[0]).toMatchObject({ status: "failed", problem: expect.stringContaining("doesn't ship to ZZ") });
    await orderSample(db, suppliers, shop, { variantId: variant.id, email: "o@x", address: home });
    await orderSample(db, suppliers, shop, { variantId: variant.id, email: "o@x", address: home });
    await expect(orderSample(db, suppliers, shop, { variantId: variant.id, email: "o@x", address: home })).rejects.toThrow("3 samples");
    await expect(orderSample(db, suppliers, shop, { variantId: variant.id, email: "o@x", address: { ...home, city: " " } })).rejects.toThrow(UserError);
  });

  it("is only for products from a connected supplier", async () => {
    const suppliers = suppliersFrom([new FakeSupplier()]);
    const db = await createTestDb();
    const user = await signUp(db, { email: "owner@example.com", password: "correct horse" });
    const shop = await createShop(db, user.id, { name: "Glow Lamps", country: "US" });
    const own = await createProduct(db, shop.id, { title: "Hand-thrown mug", status: "active", variants: [{ title: "Default", priceMinor: 2400 }] });
    const v = (await db.query.variants.findFirst({ where: eq(schema.variants.productId, own.id) }))!;
    await expect(orderSample(db, suppliers, shop, { variantId: v.id, email: "o@x", address: home })).rejects.toThrow("connected supplier");
  });
});
