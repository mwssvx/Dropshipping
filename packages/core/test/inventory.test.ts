import { describe, expect, it } from "vitest";
import { createProduct, createRestockOrder, DemoModel, inventoryCsv, inventoryReport } from "../src";
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
});
