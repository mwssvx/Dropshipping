import { describe, expect, it } from "vitest";
import { createProduct, DemoModel, listProducts, productPage } from "../src";
import { makeFixture } from "../evals/fixture";

describe("product list pages", () => {
  it("pages through products newest first and finds them by title, SKU or status", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    for (let i = 0; i < 5; i++) {
      await createProduct(f.db, shopId, { title: `Candle ${i}`, status: i % 2 ? "draft" : "active", variants: [{ title: "Default", priceMinor: 1000 + i, sku: `CND-${i}` }] });
    }
    const all = await listProducts(f.db, shopId);
    const first = await productPage(f.db, shopId, { size: 3 });
    expect(first.total).toBe(all.length);
    expect(first.products).toHaveLength(3);
    expect(first.products[0]!.variants[0]).toMatchObject({ sku: "CND-4" });
    const pages = [];
    for (let page = 1; page <= Math.ceil(all.length / 3); page++) pages.push(...(await productPage(f.db, shopId, { size: 3, page })).products);
    expect(pages.map((p) => p.id).sort()).toEqual(all.map((p) => p.id).sort());
    expect(new Set(pages.map((p) => p.id)).size).toBe(all.length);

    expect((await productPage(f.db, shopId, { query: "candle" })).total).toBe(5);
    expect((await productPage(f.db, shopId, { query: "cnd-3" })).products.map((p) => p.title)).toEqual(["Candle 3"]);
    expect((await productPage(f.db, shopId, { query: "candle", status: "draft" })).products.map((p) => p.title)).toEqual(["Candle 3", "Candle 1"]);
    expect((await productPage(f.db, shopId, { query: "nothing like it" })).total).toBe(0);
  });
});
