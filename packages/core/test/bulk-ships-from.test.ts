import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { applyBulkEdit, createGiftCardProduct, DemoModel, previewBulkEdit, undoBulkEdit } from "../src";
import { makeFixture } from "../evals/fixture";

describe("ships from in bulk", () => {
  it("sets where many products ship from, skips gift cards, and undoes it", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp, stand, projector } = f.products;
    const card = await createGiftCardProduct(f.db, shop, [2500]);
    const from = async (id: string) => (await f.db.query.products.findFirst({ where: eq(schema.products.id, id) }))!.shipsFrom;
    await f.db.update(schema.products).set({ shipsFrom: "CN" }).where(eq(schema.products.id, stand.id));
    const ids = [lamp.id, stand.id, projector.id, card.id];

    await expect(previewBulkEdit(f.db, shop, ids, { kind: "ships_from", country: "Narnia" })).rejects.toThrow("two-letter code");
    const preview = await previewBulkEdit(f.db, shop, ids, { kind: "ships_from", country: "cn" });
    expect(preview).toMatchObject({ products: 2, skipped: 1 });
    expect(preview.changes.find((c) => c.productId === lamp.id)).toMatchObject({ before: "ships from United States", after: "ships from China" });
    const edit = await applyBulkEdit(f.db, shop, ids, { kind: "ships_from", country: "CN" });
    expect(edit.summary).toBe("Set Ships from to China on 2 products");
    expect([await from(lamp.id), await from(stand.id), await from(projector.id), await from(card.id)]).toEqual(["CN", "CN", "CN", null]);

    // Set by hand since: left alone on undo.
    await f.db.update(schema.products).set({ shipsFrom: "DE" }).where(eq(schema.products.id, projector.id));
    expect(await undoBulkEdit(f.db, shop.id, edit.id)).toEqual({ restored: 1, kept: 1 });
    expect([await from(lamp.id), await from(stand.id), await from(projector.id)]).toEqual([null, "CN", "DE"]);

    // The store's own country, or empty, means it ships from home.
    const home = await applyBulkEdit(f.db, shop, ids, { kind: "ships_from", country: shop.country });
    expect(home.summary).toBe("Set Ships from to your store's country on 2 products");
    expect([await from(stand.id), await from(projector.id)]).toEqual([null, null]);
  });
});

describe("preparing time in bulk", () => {
  it("sets the days many products take to get ready, and undoes it", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp, stand, projector } = f.products;
    const days = async (id: string) => (await f.db.query.products.findFirst({ where: eq(schema.products.id, id) }))!.processingDays;
    await f.db.update(schema.products).set({ processingDays: 5 }).where(eq(schema.products.id, stand.id));
    const ids = [lamp.id, stand.id, projector.id];
    await expect(previewBulkEdit(f.db, shop, ids, { kind: "processing", days: 31 })).rejects.toThrow("Enter 0 to 30 days");
    await expect(previewBulkEdit(f.db, shop, ids, { kind: "processing", days: Number.NaN })).rejects.toThrow("Enter 0 to 30 days");
    const preview = await previewBulkEdit(f.db, shop, ids, { kind: "processing", days: 5 });
    expect(preview.products).toBe(2);
    expect(preview.changes.find((c) => c.productId === lamp.id)).toMatchObject({ before: `${shop.processingDays} days (store's)`, after: "5 days" });
    const edit = await applyBulkEdit(f.db, shop, ids, { kind: "processing", days: 5 });
    expect(edit.summary).toBe("Set preparing time to 5 days on 2 products");
    expect([await days(lamp.id), await days(stand.id), await days(projector.id)]).toEqual([5, 5, 5]);
    expect(await undoBulkEdit(f.db, shop.id, edit.id)).toEqual({ restored: 2, kept: 0 });
    expect([await days(lamp.id), await days(stand.id), await days(projector.id)]).toEqual([null, 5, null]);
    const back = await applyBulkEdit(f.db, shop, ids, { kind: "processing", days: null });
    expect(back.summary).toBe("Set preparing time to your store's on 1 product");
  });
});
