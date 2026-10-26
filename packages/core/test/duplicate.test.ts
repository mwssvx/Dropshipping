import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createCollection, createProduct, createSizeChart, DEMO_SUPPLIER_HOST, DemoModel, duplicateProduct, getProduct, listSizeCharts, setBackupSupplier } from "../src";
import { makeFixture } from "../evals/fixture";

describe("duplicate a product", () => {
  it("copies it as a draft with its options, supplier, backup, collections and size charts", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const projector = f.products.projector;
    await setBackupSupplier(f.db, f.ctx.suppliers, shop.id, projector.id, `https://${DEMO_SUPPLIER_HOST}/p/galaxy-projector`);
    const picks = await createCollection(f.db, shop.id, { title: "Picks", productIds: [projector.id] });
    await createSizeChart(f.db, shop.id, { name: "Projectors", unit: "cm", columns: ["Size", "Width"], rows: [["Small", "10"]], productIds: [projector.id] });
    await f.db.update(schema.products).set({ badge: "Bestseller", seoTitle: "Galaxy lights" }).where(eq(schema.products.id, projector.id));

    const original = await getProduct(f.db, shop.id, projector.id);
    const copy = await getProduct(f.db, shop.id, (await duplicateProduct(f.db, shop.id, projector.id)).id);
    expect(copy).toMatchObject({ title: "Copy of Galaxy Projector", handle: "copy-of-galaxy-projector", status: "draft", badge: "Bestseller", seoTitle: "Galaxy lights" });
    expect(copy.supplierId).toBe(original.supplierId);
    expect(copy.images).toEqual(original.images);
    expect(copy.variants.map((v) => [v.title, v.priceMinor, v.supplierVariantRef, v.stock])).toEqual(original.variants.map((v) => [v.title, v.priceMinor, v.supplierVariantRef, v.stock]));
    // The backup follows the copy's own options.
    expect(Object.keys(copy.backup!.variants).sort()).toEqual(copy.variants.map((v) => v.id).sort());
    expect(copy.variants.map((v) => copy.backup!.variants[v.id])).toEqual(original.variants.map((v) => original.backup!.variants[v.id]));
    const members = await f.db.query.collectionProducts.findMany({ where: eq(schema.collectionProducts.collectionId, picks.id) });
    expect(members.map((m) => m.productId).sort()).toEqual([projector.id, copy.id].sort());
    expect((await listSizeCharts(f.db, shop.id))[0]!.productIds).toEqual([projector.id, copy.id]);
    // The original is untouched, and a second copy gets its own address.
    expect((await getProduct(f.db, shop.id, projector.id)).status).toBe(original.status);
    expect((await duplicateProduct(f.db, shop.id, projector.id)).handle).toBe("copy-of-galaxy-projector-2");
  });

  it("doesn't count the merchant's own stock twice", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const mug = await createProduct(f.db, shop.id, { title: "Hand-made mug", variants: [{ title: "Blue", priceMinor: 2000, stock: 12 }, { title: "Green", priceMinor: 2000 }] });
    const copy = await getProduct(f.db, shop.id, (await duplicateProduct(f.db, shop.id, mug.id)).id);
    expect(copy.variants.map((v) => [v.title, v.stock])).toEqual([["Blue", 0], ["Green", null]]);
    await expect(duplicateProduct(f.db, shop.id, "00000000-0000-0000-0000-000000000000")).rejects.toThrow("Product not found");
  });
});
