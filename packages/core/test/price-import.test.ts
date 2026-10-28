import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createProduct, DemoModel, importPrices, productsCsv, readSheetPrice, stockHistory } from "../src";
import { makeFixture } from "../evals/fixture";

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shopId = (await f.shop()).id;
  const mug = await createProduct(f.db, shopId, {
    title: "Mug",
    status: "active",
    variants: [
      { title: "Blue", sku: "MUG-BLUE", priceMinor: 1500, compareAtMinor: 2000, stock: 10, costMinor: 400 },
      { title: "Green", sku: "MUG-GREEN", priceMinor: 1500, stock: 5 },
    ],
  });
  const variant = async (id: string) => (await f.db.query.variants.findFirst({ where: eq(schema.variants.id, id) }))!;
  return { ...f, shopId, mug, variant };
}

describe("prices and stock from a spreadsheet", () => {
  it("reads prices the way spreadsheets write them", () => {
    expect(readSheetPrice("12.99")).toBe(1299);
    expect(readSheetPrice("$12.99")).toBe(1299);
    expect(readSheetPrice("€12,99")).toBe(1299);
    expect(readSheetPrice("1,299.00")).toBe(129900);
    expect(readSheetPrice("1.299,50 EUR")).toBe(129950);
    expect(readSheetPrice("12")).toBe(1200);
    expect(() => readSheetPrice("twelve")).toThrow();
    expect(() => readSheetPrice("-5")).toThrow();
  });

  it("changes what the file says, by SKU or by handle and option, and leaves empty cells alone", async () => {
    const f = await setup();
    const [blue, green] = await f.variants(f.mug.id);
    const [lamp] = await f.variants(f.products.lamp.id);
    const csv = [
      "Handle,Variant,SKU,Price,Compare at price,Cost,Stock",
      ",,mug-blue,16.50,,4.50,",
      `${f.mug.handle},Green,,18.00,24.00,,8`,
      `${f.products.lamp.handle},${lamp!.title},,19.99,,,${(lamp!.stock ?? 0) + 5}`,
      ",,NOPE-1,10,,,",
      `${f.mug.handle},Purple,,10,,,`,
      `${f.mug.handle},,,10,,,`,
      ",,MUG-GREEN,11,,,",
      ",,MUG-BLUE,ten,,,",
      "",
    ].join("\n");
    const result = await importPrices(f.db, f.shopId, csv);
    expect(result.changed).toBe(3);
    expect(result.skipped).toEqual([
      { line: 4, ref: `${f.products.lamp.handle} / ${lamp!.title}`, reason: "Stock for supplier products comes from the supplier, so it wasn't changed." },
      { line: 5, ref: "NOPE-1", reason: "No option has this SKU." },
      { line: 6, ref: `${f.mug.handle} / Purple`, reason: 'This product has no option called "Purple".' },
      { line: 7, ref: f.mug.handle, reason: "This product has several options. Say which in the Variant column." },
      { line: 8, ref: "MUG-GREEN", reason: "This option is on an earlier line too, so this line was left out." },
      { line: 9, ref: "MUG-BLUE", reason: "This option is on an earlier line too, so this line was left out." },
    ]);
    // Blue: price and cost changed; the old compare-at price (20.00) still stands, stock as it was.
    expect(await f.variant(blue!.id)).toMatchObject({ priceMinor: 1650, compareAtMinor: 2000, costMinor: 450, stock: 10 });
    expect(await f.variant(green!.id)).toMatchObject({ priceMinor: 1800, compareAtMinor: 2400, costMinor: null, stock: 8 });
    expect(await f.variant(lamp!.id)).toMatchObject({ priceMinor: 1999, stock: lamp!.stock });
    // The stock change is in the stock history, as a count.
    expect((await stockHistory(f.db, f.shopId, f.mug.id)).filter((h) => h.reason === "count").map((h) => [h.option, h.change])).toEqual([["Green", 3]]);

    // Uploading the same file again changes nothing.
    const again = await importPrices(f.db, f.shopId, csv);
    expect(again.changed).toBe(0);
    expect(again.unchanged).toBe(3);
  });

  it("takes the compare-at price off when asked, or when the new price passes it", async () => {
    const f = await setup();
    const [blue, green] = await f.variants(f.mug.id);
    const bad = await importPrices(f.db, f.shopId, "SKU,Price,Compare at price\nMUG-GREEN,15.00,12.00\n");
    expect(bad.skipped[0]!.reason).toBe("The compare at price must be higher than the price.");
    await importPrices(f.db, f.shopId, "SKU,Price\nMUG-BLUE,21.00\n");
    expect((await f.variant(blue!.id)).compareAtMinor).toBeNull();
    await importPrices(f.db, f.shopId, "SKU,Compare at price\nMUG-GREEN,30\n");
    expect((await f.variant(green!.id)).compareAtMinor).toBe(3000);
    await importPrices(f.db, f.shopId, "SKU,Compare at price\nMUG-GREEN,-\n");
    expect((await f.variant(green!.id)).compareAtMinor).toBeNull();
  });

  it("round-trips the products download, and says what a file is missing", async () => {
    const f = await setup();
    const file = await productsCsv(f.db, f.shopId);
    const result = await importPrices(f.db, f.shopId, file);
    expect(result.changed).toBe(0);
    expect(result.skipped).toEqual([]);
    expect(result.unchanged).toBeGreaterThan(2);
    await expect(importPrices(f.db, f.shopId, "Title,Price\nMug,10\n")).rejects.toThrow("SKU or a Handle column");
    await expect(importPrices(f.db, f.shopId, "SKU,Title\nMUG-BLUE,Mug\n")).rejects.toThrow("Price, Compare at price, Cost or Stock column");
    await expect(importPrices(f.db, f.shopId, "SKU,Price\n")).rejects.toThrow("no products in it");
  });
});
