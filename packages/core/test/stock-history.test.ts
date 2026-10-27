import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createProduct, DemoModel, getProduct, patchProduct, refundOrder, stockHistory, updateProduct } from "../src";
import { makeFixture } from "../evals/fixture";

describe("stock history", () => {
  it("writes down every change to the store's own stock and why, newest first", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const mug = await createProduct(f.db, shopId, {
      title: "Mug",
      status: "active",
      variants: [
        { title: "Blue", priceMinor: 1500, stock: 5 },
        { title: "Green", priceMinor: 1500 },
      ],
    });
    const [blue, green] = await f.variants(mug.id);
    const sold = await f.order(mug.id);
    await refundOrder(f.ctx, shopId, sold.id, {});
    const product = await getProduct(f.db, shopId, mug.id);
    await updateProduct(f.db, shopId, mug.id, {
      title: "Mug",
      status: "active",
      variants: product.variants.map((v) => ({ id: v.id, title: v.title, priceMinor: v.priceMinor, stock: v.id === blue!.id ? 12 : v.stock })),
    });
    await patchProduct(f.db, shopId, mug.id, { variants: [{ id: blue!.id, stock: 10 }, { id: green!.id, stock: 3 }] });

    const history = await stockHistory(f.db, shopId, mug.id);
    expect(history.map((h) => [h.option, h.reason, h.change, h.stockAfter, h.order?.number ?? null])).toEqual([
      ["Green", "edit", 3, 3, null],
      ["Blue", "edit", -2, 10, null],
      ["Blue", "edit", 7, 12, null],
      ["Blue", "returned", 1, 5, sold.number],
      ["Blue", "sale", -1, 4, sold.number],
      ["Blue", "start", 5, 5, null],
    ]);

    // Imported products follow the supplier, so they have no history of their own.
    await f.waitingOrder();
    expect(await stockHistory(f.db, shopId, f.products.lamp.id)).toEqual([]);
    expect(await f.db.query.stockMovements.findMany({ where: eq(schema.stockMovements.variantId, blue!.id) })).toHaveLength(5);
  });
});
