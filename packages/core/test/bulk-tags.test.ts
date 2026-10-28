import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { applyBulkEdit, DemoModel, previewBulkEdit, productsCsv, recentBulkEdits, undoBulkEdit } from "../src";
import { makeFixture } from "../evals/fixture";

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  const { lamp, stand, projector } = f.products;
  const tags = async (id: string) => (await f.db.query.products.findFirst({ where: eq(schema.products.id, id) }))!.tags;
  const setTags = (id: string, t: string[]) => f.db.update(schema.products).set({ tags: t }).where(eq(schema.products.id, id));
  return { ...f, shop, ids: [lamp.id, stand.id, projector.id], lamp, stand, projector, tags, setTags };
}

describe("tags in bulk", () => {
  it("adds a tag to many products, skips ones that have it, and undoes it", async () => {
    const f = await setup();
    await f.setTags(f.lamp.id, ["summer"]);
    await f.setTags(f.stand.id, ["desk"]);
    const preview = await previewBulkEdit(f.db, f.shop, f.ids, { kind: "tag", tag: "  Summer " });
    expect(preview.products).toBe(2);
    expect(preview.changes.find((c) => c.productId === f.stand.id)).toMatchObject({ before: "desk", after: "desk, summer" });
    const edit = await applyBulkEdit(f.db, f.shop, f.ids, { kind: "tag", tag: "Summer" });
    expect(edit.summary).toBe("Added the tag “summer” on 2 products");
    expect([await f.tags(f.lamp.id), await f.tags(f.stand.id), await f.tags(f.projector.id)]).toEqual([["summer"], ["desk", "summer"], ["summer"]]);
    await expect(applyBulkEdit(f.db, f.shop, f.ids, { kind: "tag", tag: "summer" })).rejects.toThrow("Nothing to change");

    // A tag removed by hand since is left as it is; other tags added since stay.
    await f.setTags(f.projector.id, []);
    await f.setTags(f.stand.id, ["desk", "summer", "new"]);
    expect(await undoBulkEdit(f.db, f.shop.id, edit.id)).toEqual({ restored: 1, kept: 1 });
    expect([await f.tags(f.lamp.id), await f.tags(f.stand.id), await f.tags(f.projector.id)]).toEqual([["summer"], ["desk", "new"], []]);
    expect((await recentBulkEdits(f.db, f.shop.id))[0]).toMatchObject({ summary: "Added the tag “summer” on 2 products", canUndo: false });
  });

  it("removes a tag, and puts it back on undo", async () => {
    const f = await setup();
    await f.setTags(f.lamp.id, ["sale", "summer"]);
    await f.setTags(f.stand.id, ["sale"]);
    const edit = await applyBulkEdit(f.db, f.shop, f.ids, { kind: "tag", tag: "sale", remove: true });
    expect(edit.summary).toBe("Removed the tag “sale” on 2 products");
    expect([await f.tags(f.lamp.id), await f.tags(f.stand.id)]).toEqual([["summer"], []]);
    expect(await undoBulkEdit(f.db, f.shop.id, edit.id)).toEqual({ restored: 2, kept: 0 });
    expect([await f.tags(f.lamp.id), await f.tags(f.stand.id)]).toEqual([["summer", "sale"], ["sale"]]);
  });

  it("refuses bad tags and leaves out products with 20 tags", async () => {
    const f = await setup();
    await expect(previewBulkEdit(f.db, f.shop, f.ids, { kind: "tag", tag: "" })).rejects.toThrow("Enter the tag");
    await expect(previewBulkEdit(f.db, f.shop, f.ids, { kind: "tag", tag: "a, b" })).rejects.toThrow("one tag at a time");
    await expect(previewBulkEdit(f.db, f.shop, f.ids, { kind: "tag", tag: "x".repeat(31) })).rejects.toThrow("30 characters");
    await f.setTags(f.lamp.id, Array.from({ length: 20 }, (_, i) => `t${i}`));
    const preview = await previewBulkEdit(f.db, f.shop, f.ids, { kind: "tag", tag: "gift" });
    expect(preview).toMatchObject({ products: 2, full: 1 });
  });

  it("are in the products download", async () => {
    const f = await setup();
    await f.setTags(f.lamp.id, ["summer", "gift idea"]);
    const lines = (await productsCsv(f.db, f.shop.id)).trim().split("\n");
    expect(lines[0]!.endsWith(",Tags")).toBe(true);
    expect(lines.find((l) => l.startsWith(f.lamp.handle + ","))!.endsWith(',"summer, gift idea"')).toBe(true);
  });
});
