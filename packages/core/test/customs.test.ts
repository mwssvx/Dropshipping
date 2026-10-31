import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { countryCode, customsDeclaration, DemoModel, exportStore, importStore, setCustomsInfo } from "../src";
import { makeFixture } from "../evals/fixture";

describe("customs", () => {
  it("keeps a product's HS code as digits and its origin as a country code", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    expect(await setCustomsInfo(f.db, shopId, f.products.lamp.id, { hsCode: " 9405.40 ", originCountry: "cn" })).toEqual({ hsCode: "940540", originCountry: "CN", shipsFrom: null });
    await expect(setCustomsInfo(f.db, shopId, f.products.lamp.id, { hsCode: "94-05" })).rejects.toThrow("6 to 10 digits");
    await expect(setCustomsInfo(f.db, shopId, f.products.lamp.id, { originCountry: "China" })).rejects.toThrow("two-letter code");
    await expect(setCustomsInfo(f.db, shopId, f.products.lamp.id, { originCountry: "ZZ" })).rejects.toThrow("two-letter code");
    expect(await setCustomsInfo(f.db, shopId, f.products.lamp.id, { hsCode: "", originCountry: "" })).toEqual({ hsCode: null, originCountry: null, shipsFrom: null });
    expect([countryCode("de"), countryCode("XX"), countryCode("")]).toEqual(["DE", null, null]);
  });

  it("won't change another store's product", async () => {
    const f = await makeFixture(new DemoModel());
    await expect(setCustomsInfo(f.db, "00000000-0000-0000-0000-000000000000", f.products.lamp.id, { hsCode: "940540" })).rejects.toThrow("not found");
  });

  it("lists each item with its code, origin, value and weight for an order abroad", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const [v] = await f.variants(f.products.lamp.id);
    await f.db.update(schema.variants).set({ weightGrams: 450 }).where(eq(schema.variants.id, v!.id));
    const order = await f.order(f.products.lamp.id, { country: "GB" });
    let form = await customsDeclaration(f.db, shopId, order.id);
    expect(form.crossesBorder).toBe(true);
    expect(form.kind).toBe("sale");
    expect(form.missing).toEqual([form.items[0]!.description]);
    await setCustomsInfo(f.db, shopId, f.products.lamp.id, { hsCode: "940540", originCountry: "CN" });
    form = await customsDeclaration(f.db, shopId, order.id);
    expect(form.items).toEqual([{ description: expect.any(String), hsCode: "940540", originCountry: "CN", quantity: 1, valueMinor: v!.priceMinor, weightGrams: 450 }]);
    expect(form.totalValueMinor).toBe(v!.priceMinor);
    expect(form.totalWeightGrams).toBe(450);
    expect(form.missing).toEqual([]);
    expect(form.to?.country).toBe("GB");
    expect(form.from.name).toBe("Glow Lamps");
  });

  it("knows when an order stays in the country, and leaves the weight total out when a weight is missing", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const order = await f.order(f.products.lamp.id);
    const form = await customsDeclaration(f.db, shopId, order.id);
    expect(form.crossesBorder).toBe(false);
    expect(form.totalWeightGrams).toBeNull();
    await expect(customsDeclaration(f.db, "00000000-0000-0000-0000-000000000000", order.id)).rejects.toThrow("not found");
  });

  it("goes along when the store is copied", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await setCustomsInfo(f.db, shop.id, f.products.lamp.id, { hsCode: "940540", originCountry: "CN" });
    const data = await exportStore(f.db, shop.id);
    const g = await makeFixture(new DemoModel());
    const target = await g.shop();
    await g.db.delete(schema.products).where(eq(schema.products.shopId, target.id));
    await importStore(g.db, target.id, data);
    const copied = await g.db.query.products.findFirst({ where: eq(schema.products.handle, f.products.lamp.handle) });
    expect([copied!.hsCode, copied!.originCountry]).toEqual(["940540", "CN"]);
  });
});
