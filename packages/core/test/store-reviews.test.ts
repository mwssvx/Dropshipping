import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { defaultTheme, DemoModel, parseTheme, sectionDefaults, storefrontCatalog, storeReviews } from "../src";
import { makeFixture } from "../evals/fixture";

describe("the home page's buyer reviews", () => {
  it("come from published reviews of products on sale, newest first", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp, projector, stand } = f.products;
    const order = await f.order(lamp.id);
    let at = Date.now() - 10_000;
    const review = (productId: string, rating: number, status: "published" | "pending" | "hidden" = "published", extra: Partial<typeof schema.reviews.$inferInsert> = {}) =>
      f.db.insert(schema.reviews).values({ shopId: shop.id, productId, name: `R${rating}`, rating, body: `Rated ${rating}`, status, createdAt: new Date((at += 1000)), ...extra }).returning().then((r) => r[0]!);
    await review(lamp.id, 5, "published", { orderId: order.id, photoIds: ["abc"] });
    await review(projector.id, 2);
    await review(lamp.id, 1, "pending");
    await review(lamp.id, 1, "hidden");
    // The stand is a draft, so its review stays off the home page.
    await review(stand.id, 4);

    const got = await storeReviews(f.db, shop.id);
    expect(got.count).toBe(2);
    expect(got.average).toBe(3.5);
    expect(got.latest.map((r) => [r.name, r.productTitle, r.verified])).toEqual([
      ["R2", "Galaxy Projector", false],
      ["R5", "Sunset Projection Lamp", true],
    ]);
    expect(got.latest[1]!.photoUrl).toBe("/api/media/abc");
    expect((await storefrontCatalog(f.db, shop.id)).reviews.count).toBe(2);
    await f.db.update(schema.products).set({ status: "archived" }).where(eq(schema.products.id, projector.id));
    expect((await storeReviews(f.db, shop.id)).latest.map((r) => r.name)).toEqual(["R5"]);
  });

  it("is a section with a star line and a count", () => {
    expect(sectionDefaults("reviews")).toEqual({ heading: "", limit: 6, minRating: 4 });
    const theme = parseTheme({ ...baseTheme(), home: [{ id: "rev1", type: "reviews", settings: { heading: "What buyers say", limit: 3, minRating: 5 } }] });
    expect(theme.home[0]).toMatchObject({ type: "reviews", settings: { limit: 3, minRating: 5 } });
    expect(() => parseTheme({ ...baseTheme(), home: [{ id: "rev1", type: "reviews", settings: { minRating: 6 } }] })).toThrow();
  });
});

const baseTheme = () => defaultTheme("Glow Lamps");
