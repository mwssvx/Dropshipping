import { describe, expect, it } from "vitest";
import { createProduct, createRestockOrder, DemoModel, inventoryCsv, inventoryReport, restockSuggestions } from "../src";
import { makeFixture } from "../evals/fixture";

describe("inventory", () => {
  it("lists the store's own stock with its value, what's coming, and how long it lasts", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const mug = await createProduct(f.db, shop.id, { title: "Mug", status: "active", variants: [{ title: "Default", priceMinor: 1000, costMinor: 300, stock: 20, sku: "MUG-1" }] });
    const bowl = await createProduct(f.db, shop.id, { title: "Bowl", status: "active", variants: [{ title: "Large", priceMinor: 2500, stock: 2 }, { title: "Small", priceMinor: 1500 }] });
    for (let i = 0; i < 3; i++) await f.order(mug.id);
    const [large] = await f.variants(bowl.id);
    await createRestockOrder(f.db, shop.id, { supplierName: "Clay & Co", lines: [{ variantId: large!.id, quantity: 5 }] });

    const { rows, totals } = await inventoryReport(f.db, shop);
    // Supplier products and options that aren't counted stay out.
    expect(rows.map((r) => r.title)).toEqual(["Mug", "Bowl (Large)"]);
    expect(rows[0]).toMatchObject({ stock: 17, sold: 3, daysLeft: 170, valueAtCostMinor: 5100, valueAtPriceMinor: 17000, low: false });
    expect(rows[1]).toMatchObject({ stock: 2, incoming: 5, sold: 0, daysLeft: null, valueAtCostMinor: null, low: true });
    expect(totals).toEqual({ units: 19, incoming: 5, atCostMinor: 5100, atPriceMinor: 22000, missingCost: 1 });

    const [head, first] = (await inventoryCsv(f.db, shop)).trim().split("\n");
    expect(head).toBe("Option,SKU,Shelf,In stock,On the way,Cost each,Price,Value at cost,Value at price,Sold in 30 days,Days left");
    expect(first).toBe("Mug,MUG-1,,17,0,3.00,10.00,51.00,170.00,3,170");
  });

  it("suggests enough to last the next days at the pace of the last 30", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const mug = await createProduct(f.db, shop.id, { title: "Mug", status: "active", variants: [{ priceMinor: 1000, stock: 4 }] });
    const cup = await createProduct(f.db, shop.id, { title: "Cup", status: "active", variants: [{ priceMinor: 800, stock: 3 }] });
    const quiet = await createProduct(f.db, shop.id, { title: "Vase", status: "active", variants: [{ priceMinor: 800, stock: 0 }] });
    for (let i = 0; i < 3; i++) await f.order(mug.id);
    await f.order(cup.id);
    const [m] = await f.variants(mug.id);
    const [c] = await f.variants(cup.id);
    const [v] = await f.variants(quiet.id);
    await createRestockOrder(f.db, shop.id, { supplierName: "Clay & Co", lines: [{ variantId: m!.id, quantity: 2 }] });
    // Mug: 3 a month, 1 left and 2 coming. 30 days needs 3 (nothing more), 90 days needs 9 - 3 = 6.
    expect(Object.fromEntries(await restockSuggestions(f.db, shop, 30))).toEqual({});
    const ninety = await restockSuggestions(f.db, shop, 90);
    expect(ninety.get(m!.id)).toBe(6);
    // Cup: 1 a month, 2 left: 90 days needs 3, so 1 more.
    expect(ninety.get(c!.id)).toBe(1);
    expect(ninety.has(v!.id)).toBe(false);
  });
});
