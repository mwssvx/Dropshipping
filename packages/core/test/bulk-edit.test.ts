import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { applyBulkEdit, createCollection, createGiftCardProduct, DemoModel, previewBulkEdit, recentBulkEdits, undoBulkEdit, updateProduct } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  const { lamp, stand, projector } = f.products;
  const ids = [lamp.id, stand.id, projector.id];
  const prices = async (id: string) => (await f.variants(id)).map((v) => [v.priceMinor, v.compareAtMinor]);
  const status = async (id: string) => (await f.db.query.products.findFirst({ where: eq(schema.products.id, id) }))!.status;
  return { ...f, shop, ids, lamp, stand, projector, prices, status };
}

describe("bulk edit", () => {
  it("publishes, hides and archives many products, and undoes it", async () => {
    const f = await setup();
    expect([await f.status(f.lamp.id), await f.status(f.stand.id)]).toEqual(["active", "draft"]);
    const preview = await previewBulkEdit(f.db, f.shop, f.ids, { kind: "status", status: "active" });
    // The lamp and projector are already live.
    expect(preview).toMatchObject({ products: 1, changes: [{ productId: f.stand.id, before: "draft", after: "active" }] });
    const edit = await applyBulkEdit(f.db, f.shop, f.ids, { kind: "status", status: "archived" });
    expect(edit.summary).toBe("Archived on 3 products");
    expect(await f.status(f.stand.id)).toBe("archived");
    await expect(applyBulkEdit(f.db, f.shop, f.ids, { kind: "status", status: "archived" })).rejects.toThrow("Nothing to change");

    expect(await undoBulkEdit(f.db, f.shop.id, edit.id)).toEqual({ restored: 3, kept: 0 });
    expect([await f.status(f.lamp.id), await f.status(f.stand.id), await f.status(f.projector.id)]).toEqual(["active", "draft", "active"]);
    await expect(undoBulkEdit(f.db, f.shop.id, edit.id)).rejects.toThrow("already undone");
    expect((await recentBulkEdits(f.db, f.shop.id))[0]).toMatchObject({ summary: "Archived on 3 products", canUndo: false });
  });

  it("moves prices by a percent, guards against selling below cost, and keeps later hand edits on undo", async () => {
    const f = await setup();
    const [small, large] = await f.variants(f.lamp.id);
    const before = await f.prices(f.lamp.id);

    const preview = await previewBulkEdit(f.db, f.shop, [f.lamp.id], { kind: "price", percent: 10, ending: "99" });
    expect(preview.changes).toHaveLength(2);
    const edit = await applyBulkEdit(f.db, f.shop, [f.lamp.id], { kind: "price", percent: 10, ending: "99" });
    expect(edit.summary).toBe("Raised prices 10% on 1 product");
    const raised = (await f.variants(f.lamp.id)).map((v) => v.priceMinor);
    expect(raised).toEqual([small!, large!].map((v) => Math.round((v.priceMinor * 1.1) / 100) * 100 - 1));

    // 90% off would be under the supplier's cost.
    const cut = await previewBulkEdit(f.db, f.shop, [f.lamp.id], { kind: "price", percent: -90 });
    expect(cut.belowCost).toBe(2);
    await expect(applyBulkEdit(f.db, f.shop, [f.lamp.id], { kind: "price", percent: -90 })).rejects.toThrow("less than the supplier charges");
    await expect(applyBulkEdit(f.db, f.shop, [f.lamp.id], { kind: "price", percent: 0 })).rejects.toThrow("other than 0");
    const clearance = await applyBulkEdit(f.db, f.shop, [f.lamp.id], { kind: "price", percent: -90 }, { allowBelowCost: true });
    expect(clearance.summary).toBe("Lowered prices 90% on 1 product");
    expect(await undoBulkEdit(f.db, f.shop.id, clearance.id)).toEqual({ restored: 2, kept: 0 });

    // The merchant changes the Large price by hand; undo puts back only the Small one.
    const vs = await f.variants(f.lamp.id);
    await updateProduct(f.db, f.shop.id, f.lamp.id, { title: f.lamp.title, status: "active", variants: vs.map((v, i) => ({ title: v.title, priceMinor: i === 1 ? 4242 : v.priceMinor })) });
    expect(await undoBulkEdit(f.db, f.shop.id, edit.id)).toEqual({ restored: 1, kept: 1 });
    expect((await f.prices(f.lamp.id)).map((p) => p[0])).toEqual([before[0]![0], 4242]);
  });

  it("sets and clears the \"was\" price, skips gift cards, and adds to a collection", async () => {
    const f = await setup();
    const edit = await applyBulkEdit(f.db, f.shop, [f.lamp.id], { kind: "compare_at", percent: 20 });
    expect(edit.summary).toBe('Set "was" prices 20% above on 1 product');
    for (const v of await f.variants(f.lamp.id)) expect(v.compareAtMinor).toBe(Math.round(v.priceMinor * 1.2));
    // Lowering the price keeps the "was" price; raising it past the "was" price drops it.
    await applyBulkEdit(f.db, f.shop, [f.lamp.id], { kind: "price", percent: -5 });
    for (const v of await f.variants(f.lamp.id)) expect(v.compareAtMinor).toBeGreaterThan(v.priceMinor);
    await applyBulkEdit(f.db, f.shop, [f.lamp.id], { kind: "price", percent: 30 });
    for (const v of await f.variants(f.lamp.id)) expect(v.compareAtMinor).toBeNull();
    const gift = await createGiftCardProduct(f.db, f.shop, [2500, 5000]);
    const withGift = await previewBulkEdit(f.db, f.shop, [gift.id, f.projector.id], { kind: "price", percent: 10 });
    expect(withGift.skipped).toBe(1);
    expect(new Set(withGift.changes.map((c) => c.productId))).toEqual(new Set([f.projector.id]));
    await expect(previewBulkEdit(f.db, f.shop, [f.lamp.id], { kind: "compare_at", percent: 400 })).rejects.toThrow("5% to 300%");

    const sale = await createCollection(f.db, f.shop.id, { title: "Sale" });
    const add = await applyBulkEdit(f.db, f.shop, [f.lamp.id, f.projector.id], { kind: "collection", collectionId: sale.id });
    expect(add.summary).toBe("Added to Sale on 2 products");
    const members = async () => (await f.db.query.collectionProducts.findMany({ where: eq(schema.collectionProducts.collectionId, sale.id) })).map((r) => r.productId).sort();
    expect(await members()).toEqual([f.lamp.id, f.projector.id].sort());
    await applyBulkEdit(f.db, f.shop, [f.lamp.id], { kind: "collection", collectionId: sale.id, remove: true });
    expect(await members()).toEqual([f.projector.id]);
    await undoBulkEdit(f.db, f.shop.id, add.id);
    expect(await members()).toEqual([]);

    // Undo only lasts a week.
    const old = await applyBulkEdit(f.db, f.shop, [f.stand.id], { kind: "status", status: "active" });
    await expect(undoBulkEdit(f.db, f.shop.id, old.id, new Date(Date.now() + 8 * DAY))).rejects.toThrow("for 7 days");
  });
});
