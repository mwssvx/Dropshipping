import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { browseProducts, compactProducts, DemoModel, listActiveProducts, searchProducts } from "../src";
import { makeFixture } from "../evals/fixture";

describe("store search", () => {
  it("matches words in any order, ignores plurals and accents, and skips drafts", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const titles = async (q: string) => (await searchProducts(f.db, shop.id, { q })).products.map((p) => p.title);
    expect(await titles("lamp")).toEqual(["Sunset Projection Lamp"]);
    expect(await titles("LAMPS sunset")).toEqual(["Sunset Projection Lamp"]);
    expect(await titles("galáxy")).toEqual(["Galaxy Projector"]);
    expect(await titles("lamp galaxy")).toEqual([]); // every word has to match
    expect(await titles("phone stand")).toEqual([]); // a draft
    expect(await titles("zzzz")).toEqual([]);
    // No words: everything, newest first like the "All products" page.
    expect((await searchProducts(f.db, shop.id, {})).products).toHaveLength(2);
    expect((await searchProducts(f.db, shop.id, { q: "lamp" })).sort).toBe("relevance");
  });

  it("sorts by price, newest and best selling, and filters by price and stock", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const all = await listActiveProducts(f.db, shop.id);
    const low = (p: (typeof all)[number]) => Math.min(...p.variants.map((v) => v.priceMinor));
    const cheap = [...all].sort((a, b) => low(a) - low(b));
    const ids = async (o: Parameters<typeof browseProducts>[3], fx?: Parameters<typeof browseProducts>[4]) =>
      (await browseProducts(f.db, shop.id, all, o, fx)).products.map((p) => p.id);

    expect(await ids({ sort: "price_asc" })).toEqual(cheap.map((p) => p.id));
    expect(await ids({ sort: "price_desc" })).toEqual(cheap.map((p) => p.id).reverse());
    expect(await ids({ sort: "nonsense" })).toEqual(all.map((p) => p.id)); // featured: the order given
    expect(await ids({ minMinor: low(cheap[1]!) })).toEqual([cheap[1]!.id]);
    expect(await ids({ maxMinor: low(cheap[0]!) })).toEqual([cheap[0]!.id]);
    // Prices are compared in the buyer's currency.
    expect(await ids({ maxMinor: low(cheap[0]!) }, { currency: "GBP", rate: 0.5, round: false })).toEqual(
      all.filter((p) => low(p) * 0.5 <= low(cheap[0]!)).map((p) => p.id),
    );

    await f.waitingOrder(); // one lamp sold
    const lamp = f.products.lamp.id;
    expect((await ids({ sort: "best_selling" }))[0]).toBe(lamp);

    await f.db.update(schema.variants).set({ stock: 0 }).where(eq(schema.variants.productId, lamp));
    const fresh = await listActiveProducts(f.db, shop.id);
    expect((await browseProducts(f.db, shop.id, fresh, { inStock: true })).products.map((p) => p.id)).not.toContain(lamp);
    expect(compactProducts(fresh).find((p) => p.id === lamp)).toMatchObject({ priceMinor: low(all.find((p) => p.id === lamp)!) });
  });
});
