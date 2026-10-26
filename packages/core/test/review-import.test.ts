import { describe, expect, it } from "vitest";
import { eq, isNotNull } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, importReviews, listReviews, productReviews, readReviewsCsv } from "../src";
import { makeFixture } from "../evals/fixture";

const SHOPIFY = [
  "product_handle,state,rating,title,author,email,location,body,reply,created_at,replied_at",
  'sunset-projection-lamp,published,5,Love it,Ada L.,ada@example.com,Austin,"Warm light, ""perfect"" for the bedroom.",Thanks Ada!,2025-03-04 10:00:00 UTC,2025-03-05 09:00:00 UTC',
  "sunset-projection-lamp,unpublished,2,,Grace H.,grace@example.com,,Smaller than I thought.,,2025-04-01 12:00:00 UTC,",
  "sunset-projection-lamp,published,9,Bad row,Lin,lin@example.com,,No real rating,,2025-04-02 12:00:00 UTC,",
  "missing-product,published,4,,Sam,sam@example.com,,Nice,,2025-04-03 12:00:00 UTC,",
].join("\n");

const JUDGEME = [
  "title,body,rating,review_date,source,curated,reviewer_name,reviewer_email,product_id,product_handle,reply,reply_date,picture_urls",
  "Great,Bright and simple to set up.,4,2025-05-06,web,ok,Mo,mo@example.com,123,low-stock,,,https://img.example/1.jpg",
  "Buy now,cheap pills here,5,2025-05-07,web,spam,Spammer,s@example.com,123,low-stock,,,",
  ",Waiting to be checked.,3,2025-05-08,web,not-yet,Kai,kai@example.com,123,low-stock,,,",
].join("\n");

describe("bringing reviews over", () => {
  it("reads Shopify's Product Reviews and Judge.me exports", () => {
    const shopify = readReviewsCsv(SHOPIFY);
    expect(shopify.format).toBe("Shopify Product Reviews");
    expect(shopify.unusable).toBe(1);
    expect(shopify.reviews[0]).toEqual({
      handle: "sunset-projection-lamp",
      name: "Ada L.",
      rating: 5,
      body: 'Love it\nWarm light, "perfect" for the bedroom.',
      reply: "Thanks Ada!",
      createdAt: new Date("2025-03-04T10:00:00Z"),
      status: "published",
    });
    expect(shopify.reviews[1]).toMatchObject({ body: "Smaller than I thought.", status: "hidden", reply: null });

    const judgeme = readReviewsCsv(JUDGEME);
    expect(judgeme.format).toBe("Judge.me");
    // Spam is left behind.
    expect(judgeme.unusable).toBe(1);
    expect(judgeme.reviews.map((r) => [r.name, r.status, r.body])).toEqual([["Mo", "published", "Great\nBright and simple to set up."], ["Kai", "pending", "Waiting to be checked."]]);

    expect(() => readReviewsCsv("Handle,Title\nlamp,Lamp")).toThrow("doesn't look like a reviews export");
  });

  it("adds them to the products with the same address, once, without calling them verified", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const result = await importReviews(f.db, shop.id, SHOPIFY);
    expect(result).toEqual({ format: "Shopify Product Reviews", added: 2, alreadyHere: 0, missingProducts: ["missing-product"], missingCount: 1, unusable: 1 });
    // The same file again adds nothing.
    expect(await importReviews(f.db, shop.id, SHOPIFY)).toMatchObject({ added: 0, alreadyHere: 2 });

    const shown = await productReviews(f.db, f.products.lamp.id);
    expect(shown.count).toBe(1);
    expect(shown.reviews[0]).toMatchObject({ name: "Ada L.", rating: 5, reply: "Thanks Ada!", orderId: null, importedFrom: "Shopify Product Reviews", createdAt: new Date("2025-03-04T10:00:00Z") });
    // No email or location is kept.
    const stored = await f.db.query.reviews.findMany({ where: isNotNull(schema.reviews.importKey) });
    expect(JSON.stringify(stored)).not.toContain("ada@example.com");

    // The admin list shows them next to reviews from real orders.
    const hidden = await listReviews(f.db, shop.id, { status: "hidden" });
    expect(hidden).toMatchObject([{ review: { name: "Grace H." }, productTitle: "Sunset Projection Lamp", orderNumber: null }]);

    await importReviews(f.db, shop.id, JUDGEME.replaceAll("low-stock", f.products.projector.handle));
    const projector = await f.db.query.reviews.findMany({ where: eq(schema.reviews.productId, f.products.projector.id) });
    expect(projector.map((r) => r.status).sort()).toEqual(["pending", "published"]);
  });
});
