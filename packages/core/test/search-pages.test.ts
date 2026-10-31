import { describe, expect, it } from "vitest";
import { createCollection, createPage, createPost, DemoModel, saveTranslation, searchPages, setShopLanguages } from "../src";
import { makeFixture } from "../evals/fixture";

describe("collections and pages in store search", () => {
  it("finds collections, pages and posts with every word in their title, best first", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await createCollection(f.db, shop.id, { title: "Lamp shades", imageUrl: "https://example.com/shades.jpg" });
    await createCollection(f.db, shop.id, { title: "Desk lamps" });
    await createCollection(f.db, shop.id, { title: "Mugs" });
    await createPage(f.db, shop.id, { title: "Caring for your lamp" });
    await createPage(f.db, shop.id, { title: "Lamp recycling", published: false });
    await createPost(f.db, shop.id, { title: "Five lamps for reading", body: "Good light makes long evenings with a book easier on the eyes. Here are five lamps we like for reading in bed or in an armchair." }, { published: true });
    await createPost(f.db, shop.id, { title: "Lamp drafts" });

    const found = await searchPages(f.db, shop.id, "Lamps", null);
    expect(found.collections).toEqual([
      { kind: "collection", title: "Lamp shades", path: "/collections/lamp-shades", imageUrl: "https://example.com/shades.jpg" },
      { kind: "collection", title: "Desk lamps", path: "/collections/desk-lamps", imageUrl: null },
    ]);
    // Unpublished pages and draft posts stay out.
    expect(found.pages.map((p) => [p.kind, p.title, p.path])).toEqual([
      ["page", "Caring for your lamp", "/pages/caring-for-your-lamp"],
      ["post", "Five lamps for reading", `/blog/${found.pages[1]!.path.split("/").at(-1)}`],
    ]);
    // Every word has to be in the title, in any order.
    expect((await searchPages(f.db, shop.id, "desk lamp", null)).collections.map((c) => c.title)).toEqual(["Desk lamps"]);
    expect((await searchPages(f.db, shop.id, "lamp mug", null)).collections).toEqual([]);
    expect(await searchPages(f.db, shop.id, "  ", null)).toEqual({ collections: [], pages: [] });
    expect((await searchPages(f.db, shop.id, "lamp", null, 1)).collections).toHaveLength(1);
  });

  it("matches and shows titles in the buyer's language", async () => {
    const f = await makeFixture(new DemoModel());
    await setShopLanguages(f.db, (await f.shop()).id, ["fr"]);
    const shop = await f.shop();
    const lamps = await createCollection(f.db, shop.id, { title: "Lamps" });
    const shipping = await createPage(f.db, shop.id, { title: "Shipping" });
    await saveTranslation(f.db, shop, { language: "fr", kind: "collection", refId: lamps.id, fields: { title: "Lampes" } });
    await saveTranslation(f.db, shop, { language: "fr", kind: "page", refId: shipping.id, fields: { title: "Livraison" } });

    expect((await searchPages(f.db, shop.id, "lampes", "fr")).collections.map((c) => c.title)).toEqual(["Lampes"]);
    // The store's own words still work, shown in the buyer's language.
    expect((await searchPages(f.db, shop.id, "shipping", "fr")).pages.map((p) => p.title)).toEqual(["Livraison"]);
    expect((await searchPages(f.db, shop.id, "livraison", null)).pages).toEqual([]);
  });
});
