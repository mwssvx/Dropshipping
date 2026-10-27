import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createProduct, DemoModel, recordStockCount, stockHistory } from "../src";
import { makeFixture } from "../evals/fixture";

describe("stock count", () => {
  it("sets each counted option to what's on the shelf and records the difference", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const mug = await createProduct(f.db, shopId, {
      title: "Mug",
      status: "active",
      variants: [
        { title: "Blue", priceMinor: 1500, stock: 10, costMinor: 400 },
        { title: "Green", priceMinor: 1500, stock: 5 },
        { title: "Red", priceMinor: 1500 },
      ],
    });
    const [blue, green, red] = await f.variants(mug.id);
    const result = await recordStockCount(f.db, shopId, [
      { variantId: blue!.id, counted: 7 },
      { variantId: green!.id, counted: 5 },
      { variantId: red!.id, counted: 2 },
    ]);
    expect(result).toEqual({ changed: 2, missing: 3, found: 2, missingCostMinor: 1200 });
    const stock = async (id: string) => (await f.db.query.variants.findFirst({ where: eq(schema.variants.id, id) }))!.stock;
    expect([await stock(blue!.id), await stock(green!.id), await stock(red!.id)]).toEqual([7, 5, 2]);
    const history = await stockHistory(f.db, shopId, mug.id);
    expect(history.filter((h) => h.reason === "count").map((h) => [h.option, h.change, h.stockAfter])).toEqual([
      ["Red", 2, 2],
      ["Blue", -3, 7],
    ]);
  });

  it("only counts the store's own stock, in whole numbers", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const [lamp] = await f.variants(f.products.lamp.id);
    await expect(recordStockCount(f.db, shopId, [{ variantId: lamp!.id, counted: 3 }])).rejects.toThrow("aren't stock you keep yourself");
    await expect(recordStockCount(f.db, shopId, [{ variantId: lamp!.id, counted: -1 }])).rejects.toThrow("whole numbers");
    await expect(recordStockCount(f.db, shopId, [])).rejects.toThrow("at least one option");
  });
});
