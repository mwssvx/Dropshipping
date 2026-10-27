import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { compactProducts, DemoModel, exportStore, formatContents, formatUnitPrice, googleFeedXml, listActiveProducts, parseContents, productFeed, setVariantContents, storefrontCatalog, unitPrice } from "../src";
import { makeFixture } from "../evals/fixture";

describe("price per unit", () => {
  it("is per 100 g or 100 ml for small packs, else per kg, litre, metre, square metre or item", () => {
    expect(unitPrice(599, { amount: 250, unit: "g" })).toEqual({ priceMinor: 240, per: "100 g" });
    expect(unitPrice(1299, { amount: 1, unit: "kg" })).toEqual({ priceMinor: 1299, per: "kg" });
    expect(unitPrice(899, { amount: 500, unit: "g" })).toEqual({ priceMinor: 1798, per: "kg" });
    expect(unitPrice(450, { amount: 75, unit: "cl" })).toEqual({ priceMinor: 600, per: "l" });
    expect(unitPrice(300, { amount: 200, unit: "ml" })).toEqual({ priceMinor: 150, per: "100 ml" });
    expect(unitPrice(1500, { amount: 250, unit: "cm" })).toEqual({ priceMinor: 600, per: "m" });
    expect(unitPrice(2000, { amount: 2.5, unit: "m2" })).toEqual({ priceMinor: 800, per: "m²" });
    expect(unitPrice(1200, { amount: 6, unit: "item" })).toEqual({ priceMinor: 200, per: "item" });
    // One item, or nothing said, has nothing to compare by.
    expect(unitPrice(1200, { amount: 1, unit: "item" })).toBeNull();
    expect(unitPrice(1200, null)).toBeNull();
    expect(formatUnitPrice("€2.40", "100 g")).toBe("€2.40 / 100 g");
    expect(formatUnitPrice("€2.00", "item", "Stück")).toBe("€2.00 / Stück");
    expect(formatContents({ amount: 1.5, unit: "l" })).toBe("1.5 l");
    expect(formatContents({ amount: 6, unit: "item" })).toBe("6 items");
  });

  it("takes what the merchant types, and blank means none", () => {
    expect(parseContents("1,5", "l")).toEqual({ amount: 1.5, unit: "l" });
    expect(parseContents(" 250 ", "g")).toEqual({ amount: 250, unit: "g" });
    expect(parseContents("", "g")).toBeNull();
    expect(() => parseContents("0", "g")).toThrow();
    expect(() => parseContents("abc", "g")).toThrow();
    expect(() => parseContents("5", "stone")).toThrow();
  });

  it("is saved per option and reaches the store, its feed and its backup", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp } = f.products;
    const [small, large] = await f.variants(lamp.id);
    await expect(setVariantContents(f.db, shop.id, lamp.id, [{ variantId: small!.id, amount: "lots", unit: "g" }])).rejects.toThrow(`The contents of ${small!.title}`);
    expect(await setVariantContents(f.db, shop.id, lamp.id, [{ variantId: small!.id, amount: "250", unit: "g" }, { variantId: large!.id, amount: "", unit: "g" }])).toBe(1);
    const [saved] = await f.variants(lamp.id);
    expect(saved!.contents).toEqual({ amount: 250, unit: "g" });

    const catalog = await storefrontCatalog(f.db, shop.id);
    expect(catalog.products.find((p) => p.id === lamp.id)!.contents).toEqual({ amount: 250, unit: "g" });
    const compact = compactProducts(await listActiveProducts(f.db, shop.id)).find((p) => p.id === lamp.id)!;
    expect(compact).toHaveProperty("contents");

    await f.db.update(schema.products).set({ images: ["https://img.example/lamp.jpg"], imageUrl: "https://img.example/lamp.jpg" }).where(eq(schema.products.id, lamp.id));
    const { items } = await productFeed(f.db, shop, { origin: "https://glow.example" });
    expect(items.find((i) => i.id === small!.id)!.unitPricing).toEqual({ measure: "250g", base: "100g" });
    expect(items.find((i) => i.id === large!.id)!.unitPricing).toBeNull();
    expect(googleFeedXml(shop, "https://glow.example", items)).toContain("<g:unit_pricing_measure>250g</g:unit_pricing_measure><g:unit_pricing_base_measure>100g</g:unit_pricing_base_measure>");

    const backup = await exportStore(f.db, shop.id);
    const exported = (backup as { products: { variants: { title: string; contents?: unknown }[] }[] }).products.flatMap((p) => p.variants);
    expect(exported.find((v) => v.title === small!.title)!.contents).toEqual({ amount: 250, unit: "g" });
  });
});
