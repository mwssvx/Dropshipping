import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, duplicateProduct, exportStore, getTranslation, importStore, localizeProducts, parseDetails, saveTranslation, setProductDetails, setShopLanguages } from "../src";
import { makeFixture } from "../evals/fixture";

describe("product details", () => {
  it("reads one label and value per line", () => {
    expect(parseDetails("Material: Aluminium\n\n  Size : 20 × 10 cm \r\nTimer: 10:30 or 12:00", { strict: true })).toEqual([
      { label: "Material", value: "Aluminium" },
      { label: "Size", value: "20 × 10 cm" },
      // Only the first colon splits, so times and ratios stay whole.
      { label: "Timer", value: "10:30 or 12:00" },
    ]);
    expect(parseDetails("", { strict: true })).toEqual([]);
    expect(() => parseDetails("Material: Aluminium\nJust some text", { strict: true })).toThrow('Line 2 needs a label and a value with a colon between them, like "Material: Aluminium".');
    expect(() => parseDetails(": no label", { strict: true })).toThrow("Line 1 needs a label");
    expect(() => parseDetails(`${"x".repeat(41)}: y`, { strict: true })).toThrow("Line 1: keep the label under 40 characters.");
    expect(() => parseDetails("Care: <b>wipe</b>", { strict: true })).toThrow("plain text");
    expect(() => parseDetails(Array.from({ length: 21 }, (_, i) => `L${i}: v`).join("\n"), { strict: true })).toThrow("up to 20 details");
    // A translation keeps the lines it can read.
    expect(parseDetails("Material: Aluminium\nbroken line\nGröße: 20 cm")).toEqual([{ label: "Material", value: "Aluminium" }, { label: "Größe", value: "20 cm" }]);
  });

  it("is saved per product, copied with it, and comes along in a store export", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const id = f.products.lamp.id;
    expect(await setProductDetails(f.db, shop.id, id, "Material: Aluminium\nPower: USB-C")).toHaveLength(2);
    const row = await f.db.query.products.findFirst({ where: eq(schema.products.id, id) });
    expect(row!.details).toEqual([{ label: "Material", value: "Aluminium" }, { label: "Power", value: "USB-C" }]);

    const copy = await duplicateProduct(f.db, shop.id, id);
    expect((await f.db.query.products.findFirst({ where: eq(schema.products.id, copy.id) }))!.details).toEqual(row!.details);

    const data = await exportStore(f.db, shop.id);
    expect(data.products.find((p) => p.handle === row!.handle)!.details).toEqual(row!.details);
    const g = await makeFixture(new DemoModel());
    const target = await g.shop();
    await g.db.delete(schema.products).where(eq(schema.products.shopId, target.id));
    await importStore(g.db, target.id, data);
    expect((await g.db.query.products.findFirst({ where: eq(schema.products.handle, row!.handle) }))!.details).toEqual(row!.details);

    expect(await setProductDetails(f.db, shop.id, id, "  ")).toEqual([]);
    expect((await f.db.query.products.findFirst({ where: eq(schema.products.id, id) }))!.details).toEqual([]);
  });

  it("is translated with the product's title and description", async () => {
    const f = await makeFixture(new DemoModel());
    await setShopLanguages(f.db, (await f.shop()).id, ["de"]);
    const shop = await f.shop();
    const { lamp } = f.products;
    await setProductDetails(f.db, shop.id, lamp.id, "Material: Aluminium\nPower: USB-C");
    const item = await getTranslation(f.db, shop, "de", "product", lamp.id);
    expect(item.source.details).toBe("Material: Aluminium\nPower: USB-C");
    expect(item.status).toBe("missing");

    await saveTranslation(f.db, shop, { language: "de", kind: "product", refId: lamp.id, fields: { title: "Sonnenuntergangslampe", details: "Material: Aluminium\nStrom: USB-C" } });
    const original = { id: lamp.id, title: lamp.title, details: [{ label: "Material", value: "Aluminium" }, { label: "Power", value: "USB-C" }] };
    const [de] = await localizeProducts(f.db, shop.id, "de", [original]);
    expect(de!.details).toEqual([{ label: "Material", value: "Aluminium" }, { label: "Strom", value: "USB-C" }]);

    // Changing the details marks the translation out of date.
    await setProductDetails(f.db, shop.id, lamp.id, "Material: Steel\nPower: USB-C");
    expect((await getTranslation(f.db, shop, "de", "product", lamp.id)).status).toBe("outdated");
  });
});
