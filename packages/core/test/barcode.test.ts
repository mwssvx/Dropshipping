import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { CODE128, code128Bars, code128Values, createProduct, DemoModel, exportStore, importStore, parseBarcode, restockChoices, updateProduct } from "../src";
import { makeFixture } from "../evals/fixture";

// Reads symbol values back into text, the way a scanner would.
function decode(values: number[]) {
  let set = values[0] === 105 ? "C" : "B";
  let out = "";
  for (const v of values.slice(1, -2)) {
    if (v === 99) set = "C";
    else if (v === 100) set = "B";
    else out += set === "C" ? String(v).padStart(2, "0") : String.fromCharCode(v + 32);
  }
  return out;
}

describe("barcodes", () => {
  it("has a well-formed Code 128 table", () => {
    expect(CODE128).toHaveLength(107);
    expect(new Set(CODE128).size).toBe(107);
    CODE128.forEach((p, v) => {
      const w = [...p].map(Number);
      expect(w.reduce((a, b) => a + b, 0)).toBe(v === 106 ? 13 : 11);
      // Every symbol's bars add up to an even number of modules.
      if (v < 106) expect((w[0]! + w[2]! + w[4]!) % 2).toBe(0);
    });
  });

  it("encodes text and numbers with a check symbol, using pairs of digits where it's shorter", () => {
    // Start B, P J J 1 2 3 C, then the check: 104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7 = 879, mod 103 = 55.
    expect(code128Values("PJJ123C")).toEqual([104, 48, 42, 42, 17, 18, 19, 35, 55, 106]);
    // All digits, even count: set C from the start.
    const upc = code128Values("012345678905");
    expect(upc[0]).toBe(105);
    expect(upc).toHaveLength(1 + 6 + 2);
    for (const code of ["012345678905", "MUG-BLUE-01", "A1234567B", "12345", "x", "SKU 99"]) expect(decode(code128Values(code))).toBe(code);
    const { bars, width } = code128Bars("MUG-1");
    expect(bars[0]![0]).toBe(10);
    expect(width).toBe(10 + 11 * (1 + 5 + 1) + 13 + 10);
    expect(() => code128Values("café")).toThrow("up to 48");
  });

  it("keeps barcodes trimmed, and not two options with the same one", async () => {
    expect(parseBarcode("  012345678905 ")).toBe("012345678905");
    expect(parseBarcode("")).toBeNull();
    expect(() => parseBarcode("x".repeat(49))).toThrow("up to 48");
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const mug = await createProduct(f.db, shopId, {
      title: "Mug",
      status: "active",
      variants: [
        { title: "Blue", priceMinor: 1500, stock: 3, barcode: " 012345678905 ", sku: "MUG-B" },
        { title: "Red", priceMinor: 1500, stock: 1 },
      ],
    });
    const [blue, red] = await f.variants(mug.id);
    expect(blue!.barcode).toBe("012345678905");
    await expect(
      updateProduct(f.db, shopId, mug.id, {
        title: "Mug",
        status: "active",
        variants: [
          { id: blue!.id, title: "Blue", priceMinor: 1500 },
          { id: red!.id, title: "Red", priceMinor: 1500, barcode: "012345678905" },
        ],
      }),
    ).rejects.toThrow("Mug (Blue) already has the barcode 012345678905");
    await expect(createProduct(f.db, shopId, { title: "Cup", variants: [{ priceMinor: 900, barcode: "012345678905" }] })).rejects.toThrow("already has the barcode");
    expect((await restockChoices(f.db, shopId)).find((c) => c.variantId === blue!.id)?.barcode).toBe("012345678905");
  });

  it("go along when the store is copied", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const mug = await createProduct(f.db, shop.id, { title: "Mug", status: "active", variants: [{ priceMinor: 1500, barcode: "4006381333931", location: "B4" }] });
    const data = await exportStore(f.db, shop.id);
    const g = await makeFixture(new DemoModel());
    const target = await g.shop();
    await g.db.delete(schema.products).where(eq(schema.products.shopId, target.id));
    await importStore(g.db, target.id, data);
    const copied = await g.db.query.products.findFirst({ where: eq(schema.products.handle, mug.handle) });
    const [v] = await g.variants(copied!.id);
    expect([v!.barcode, v!.location]).toEqual(["4006381333931", "B4"]);
  });
});
