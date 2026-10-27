import { describe, expect, it } from "vitest";
import { createProduct, DemoModel, pickList } from "../src";
import { makeFixture } from "../evals/fixture";

describe("pick list", () => {
  it("adds up the store's own stock the waiting orders need, by SKU, and leaves supplier items off", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    expect(await pickList(f.db, shopId)).toEqual({ items: [], orders: 0, fromSuppliers: 0 });
    const soap = await createProduct(f.db, shopId, { title: "Soap", status: "active", variants: [{ priceMinor: 600, stock: 5, sku: "B-2", barcode: "4006381333931" }] });
    const mug = await createProduct(f.db, shopId, { title: "Mug", status: "active", variants: [{ priceMinor: 1500, stock: 1, sku: "A-10" }] });
    const candle = await createProduct(f.db, shopId, { title: "Candle", status: "active", variants: [{ priceMinor: 900, stock: 2 }] });
    const o1 = await f.order(soap.id);
    const o2 = await f.order(soap.id);
    const o3 = await f.order(mug.id);
    await f.order(candle.id);
    await f.order(f.products.lamp.id);
    const list = await pickList(f.db, shopId);
    expect(list.items.map((i) => [i.title, i.sku, i.quantity, i.stock, i.orders])).toEqual([
      ["Mug", "A-10", 1, 0, [o3.number]],
      ["Soap", "B-2", 2, 3, [o1.number, o2.number]],
      ["Candle", null, 1, 1, [expect.any(Number)]],
    ]);
    expect(list.items[1]!.barcode).toBe("4006381333931");
    expect(list.orders).toBe(4);
    expect(list.fromSuppliers).toBe(1);
  });

  it("walks the shelf in order when options have a location", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const a = await createProduct(f.db, shopId, { title: "Zinc Tray", status: "active", variants: [{ priceMinor: 600, stock: 5, sku: "Z-1", location: " A2 " }] });
    const b = await createProduct(f.db, shopId, { title: "Apple Box", status: "active", variants: [{ priceMinor: 600, stock: 5, sku: "A-1", location: "A10" }] });
    const c = await createProduct(f.db, shopId, { title: "Cup", status: "active", variants: [{ priceMinor: 600, stock: 5, sku: "C-1" }] });
    for (const p of [b, c, a]) await f.order(p.id);
    const { items } = await pickList(f.db, shopId);
    expect(items.map((i) => [i.title, i.location])).toEqual([
      ["Zinc Tray", "A2"],
      ["Apple Box", "A10"],
      ["Cup", null],
    ]);
    await expect(createProduct(f.db, shopId, { title: "X", variants: [{ priceMinor: 1, location: "x".repeat(41) }] })).rejects.toThrow("under 40 characters");
  });
});
