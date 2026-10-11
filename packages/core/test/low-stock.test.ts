import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, exportStore, importStore, lowStockLeft, setLowStockNote } from "../src";
import { makeFixture } from "../evals/fixture";

describe("few left note", () => {
  it("only counts real stock at or below the store's number", () => {
    const shop = { lowStockNote: 5 };
    expect(lowStockLeft(shop, 3)).toBe(3);
    expect(lowStockLeft(shop, 5)).toBe(5);
    expect(lowStockLeft(shop, 6)).toBeNull();
    // Sold out says "Sold out", and no stock count means nothing to say.
    expect(lowStockLeft(shop, 0)).toBeNull();
    expect(lowStockLeft(shop, null)).toBeNull();
    expect(lowStockLeft({ lowStockNote: 0 }, 1)).toBeNull();
  });

  it("is set per store and comes along in a store export", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    expect(shop.lowStockNote).toBe(5);
    await expect(setLowStockNote(f.db, shop.id, 51)).rejects.toThrow("from 0 to 50");
    await expect(setLowStockNote(f.db, shop.id, 2.5)).rejects.toThrow("from 0 to 50");
    await expect(setLowStockNote(f.db, shop.id, Number.NaN)).rejects.toThrow("from 0 to 50");
    await setLowStockNote(f.db, shop.id, 10);
    expect((await f.shop()).lowStockNote).toBe(10);
    const data = await exportStore(f.db, shop.id);
    expect(data.store.low_stock_note).toBe(10);
    const g = await makeFixture(new DemoModel());
    const target = await g.shop();
    await g.db.delete(schema.products).where(eq(schema.products.shopId, target.id));
    await importStore(g.db, target.id, data);
    expect((await g.shop()).lowStockNote).toBe(10);
  });
});
