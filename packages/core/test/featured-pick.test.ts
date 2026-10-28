import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { defaultTheme, DemoModel, parseTheme, sectionDefaults, storefrontCatalog } from "../src";
import { featuredViewAll, pickFeatured } from "../src/theme-doc";
import { makeFixture } from "../evals/fixture";

const card = (id: string, o: { sold?: number; at?: number; price?: number; compareAt?: number | null; soldOut?: boolean } = {}) => ({
  id,
  priceMinor: o.price ?? 1000,
  compareAtMinor: o.compareAt ?? null,
  sold: o.sold ?? 0,
  soldOut: o.soldOut ?? false,
  createdAt: new Date(o.at ?? 0).toISOString(),
});

describe("what a featured products grid shows", () => {
  const list = [
    card("a", { sold: 1, at: 3 }),
    card("b", { sold: 9, at: 1, compareAt: 2000 }),
    card("c", { sold: 9, at: 2, compareAt: 1000 }),
    card("d", { sold: 50, at: 9, compareAt: 1500, soldOut: true }),
    card("e", { sold: 0, at: 5, price: 500, compareAt: 900 }),
  ];
  const ids = (show: Parameters<typeof pickFeatured>[1]) => pickFeatured(list, show).map((p) => p.id);

  it("keeps the collection's order by default", () => {
    expect(ids("listed")).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("puts best sellers first, ties in the collection's order, sold out last", () => {
    expect(ids("best_selling")).toEqual(["b", "c", "a", "e", "d"]);
  });

  it("puts the newest first, sold out last", () => {
    expect(ids("newest")).toEqual(["e", "a", "c", "b", "d"]);
  });

  it("shows only products whose price is below the compare-at price", () => {
    expect(ids("on_sale")).toEqual(["b", "e", "d"]);
  });

  it("sends View all to a list in the same order", () => {
    expect(featuredViewAll("all", "listed")).toBe("/collections/all");
    expect(featuredViewAll("gifts", "best_selling")).toBe("/collections/gifts?sort=best_selling");
    expect(featuredViewAll("all", "newest")).toBe("/collections/all?sort=newest");
    expect(featuredViewAll("all", "on_sale")).toBe("/collections/all?sale=1");
  });

  it("is a setting on the section that older themes don't have", () => {
    expect(sectionDefaults("featured_products")).toMatchObject({ show: "listed" });
    const theme = parseTheme({ ...defaultTheme("Glow Lamps"), home: [{ id: "feat1", type: "featured_products", settings: { heading: "Hot", limit: 4 } }] });
    expect(theme.home[0]).toMatchObject({ settings: { show: "listed" } });
    const picked = parseTheme({ ...defaultTheme("Glow Lamps"), home: [{ id: "feat1", type: "featured_products", settings: { show: "on_sale" } }] });
    expect(picked.home[0]).toMatchObject({ settings: { show: "on_sale" } });
    expect(() => parseTheme({ ...defaultTheme("Glow Lamps"), home: [{ id: "feat1", type: "featured_products", settings: { show: "random" } }] })).toThrow();
  });

  it("counts units sold in paid orders for the store's catalog", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp, projector } = f.products;
    await f.order(lamp.id);
    await f.order(lamp.id);
    const unpaid = await f.order(projector.id);
    await f.db.update(schema.orders).set({ paymentStatus: "pending" }).where(eq(schema.orders.id, unpaid.id));
    const catalog = await storefrontCatalog(f.db, shop.id);
    const sold = Object.fromEntries(catalog.products.map((p) => [p.title, p.sold]));
    expect(sold).toEqual({ "Sunset Projection Lamp": 2, "Galaxy Projector": 0 });
    expect(pickFeatured(catalog.products, "best_selling")[0]!.title).toBe("Sunset Projection Lamp");
  });
});
