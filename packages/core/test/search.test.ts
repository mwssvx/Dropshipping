import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { browseProducts, cjOptions, compactProducts, createProduct, updateProduct, DemoModel, listActiveProducts, optionFacets, searchProducts } from "../src";
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

  it("filters by size and colour on one variant, and by what's on sale", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const make = (title: string, variants: { options: Record<string, string>; priceMinor: number; compareAtMinor?: number; stock?: number }[]) =>
      createProduct(f.db, shop.id, { title, status: "active", variants: variants.map((v) => ({ title: Object.values(v.options).join(" / "), ...v })) } as never);
    const tee = await make("Plain tee", [
      { options: { Color: "Black", Size: "M" }, priceMinor: 2000, stock: 0 },
      { options: { Color: "White", Size: "L" }, priceMinor: 2000 },
    ]);
    const hoodie = await make("Hoodie", [
      { options: { colour: "Black", Size: "L" }, priceMinor: 4000, compareAtMinor: 5000 },
      { options: { colour: "Grey", Size: "M" }, priceMinor: 4000 },
    ]);
    const all = await listActiveProducts(f.db, shop.id);
    const titles = async (o: Parameters<typeof browseProducts>[3]) => (await browseProducts(f.db, shop.id, all, o)).products.map((p) => p.title).sort();

    // Options are offered with product counts, whatever the case of their name; one-value options aren't.
    const facets = optionFacets(all);
    expect(facets.find((x) => x.name === "Color")!.values).toEqual(expect.arrayContaining([{ value: "Black", count: 2 }, { value: "White", count: 1 }, { value: "Grey", count: 1 }]));
    expect(facets.find((x) => x.name === "Size")!.values).toEqual(expect.arrayContaining([{ value: "M", count: 2 }, { value: "L", count: 2 }]));

    expect(await titles({ options: { Color: ["Black"] } })).toEqual(["Hoodie", "Plain tee"]);
    expect(await titles({ options: { colour: ["White", "Grey"] } })).toEqual(["Hoodie", "Plain tee"]);
    // A black tee only comes in M, so black and L is just the hoodie.
    expect(await titles({ options: { Color: ["Black"], Size: ["L"] } })).toEqual(["Hoodie"]);
    // The black M tee is sold out.
    expect(await titles({ options: { Color: ["Black"] }, inStock: true })).toEqual(["Hoodie"]);
    expect(await titles({ onSale: true })).toEqual(["Hoodie"]);
    expect(await titles({ onSale: true, options: { Size: ["M"] } })).toEqual([]);
    // The facets stay the same when an option is picked, so the other values can still be chosen.
    expect((await browseProducts(f.db, shop.id, all, { options: { Color: ["Black"] } })).facets).toEqual(facets);
    expect([tee.id, hoodie.id]).toHaveLength(2);
  });

  it("reads option names from supplier listings", () => {
    expect(cjOptions("Color-Size", "Black-XL")).toEqual({ Color: "Black", Size: "XL" });
    expect(cjOptions("Color", "Black-XL")).toEqual({});
    expect(cjOptions(undefined, "Black")).toEqual({});
  });

  it("keeps an imported product's size when the merchant renames it", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const vs = await f.variants(f.products.lamp.id);
    expect(vs.map((v) => v.options)).toEqual([{ Size: "Small" }, { Size: "Large" }]);
    await updateProduct(f.db, shop.id, f.products.lamp.id, {
      title: f.products.lamp.title,
      status: "active",
      variants: vs.map((v, i) => ({ title: i === 0 ? "S" : v.title, priceMinor: v.priceMinor })),
    });
    expect((await f.variants(f.products.lamp.id)).map((v) => v.options)).toEqual([{ Size: "S" }, { Size: "Large" }]);
  });
});
