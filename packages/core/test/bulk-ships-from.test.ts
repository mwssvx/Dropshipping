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
