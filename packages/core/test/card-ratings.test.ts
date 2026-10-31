import { describe, expect, it } from "vitest";
import { schema } from "@sf/db";
import { DemoModel, defaultTheme, parseTheme, productRatings, storefrontCatalog } from "../src";
import { makeFixture } from "../evals/fixture";

describe("stars on product cards", () => {
  it("averages each product's published reviews and leaves unreviewed ones without stars", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const { lamp, projector } = f.products;
    await f.db.insert(schema.reviews).values([
      { shopId, productId: lamp.id, name: "Ada", rating: 5, body: "Lovely", status: "published" },
      { shopId, productId: lamp.id, name: "Bo", rating: 4, body: "Good", status: "published" },
      { shopId, productId: lamp.id, name: "Di", rating: 4, body: "Fine", status: "published" },
      { shopId, productId: lamp.id, name: "Cy", rating: 1, body: "Spam", status: "hidden" },
      { shopId, productId: projector.id, name: "Ed", rating: 2, body: "Not yet checked", status: "pending" },
    ]);

    const ratings = await productRatings(f.db, shopId, [lamp.id, projector.id, lamp.id]);
    expect(ratings.get(lamp.id)).toEqual({ average: 4.3, count: 3 });
    expect(ratings.has(projector.id)).toBe(false);
    expect((await productRatings(f.db, shopId, [])).size).toBe(0);
    // Another store's ids never pick up these reviews.
    expect((await productRatings(f.db, "00000000-0000-4000-8000-000000000000", [lamp.id])).size).toBe(0);

    const catalog = await storefrontCatalog(f.db, shopId);
    expect(catalog.products.find((p) => p.id === lamp.id)!.rating).toEqual({ average: 4.3, count: 3 });
    expect(catalog.products.find((p) => p.id === projector.id)?.rating ?? null).toBeNull();
  });

  it("is on by default and can be turned off in the theme", () => {
    const doc = defaultTheme("Shop");
    expect(doc.settings.cardRatings).toBe(true);
    const older: Partial<typeof doc.settings> = { ...doc.settings };
    delete older.cardRatings;
    expect(parseTheme({ ...doc, settings: older }).settings.cardRatings).toBe(true);
    expect(parseTheme({ ...doc, settings: { ...doc.settings, cardRatings: false } }).settings.cardRatings).toBe(false);
  });
});
