import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, reportReview, reviewFeedXml, submitReview } from "../src";
import { makeFixture } from "../evals/fixture";

describe("Google product review feed", () => {
  it("lists published reviews with their stars and product, and leaves out the rest", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = { ...(await f.shop()), reviewsAutoPublish: true };
    const order = await f.shippedOrder();
    const verified = await submitReview(f.db, shop, order.paymentIntentId!, { productId: f.products.lamp.id, rating: 4, name: "Ada <L>", body: "Bright & warm, a \"must\"." });
    const base = { shopId: shop.id, rating: 5, body: "Imported one.", importKey: "" };
    await f.db.insert(schema.reviews).values([
      { ...base, productId: f.products.lamp.id, name: "Imported", status: "published", importKey: "a" },
      { ...base, productId: f.products.lamp.id, name: "Hidden", status: "hidden", importKey: "b" },
      { ...base, productId: f.products.lamp.id, name: "Waiting", status: "pending", importKey: "c" },
      // The stand isn't on sale, so its reviews stay out too.
      { ...base, productId: f.products.stand.id, name: "Draft product", status: "published", importKey: "d" },
    ]);
    const [reported] = await f.db.insert(schema.reviews).values({ ...base, productId: f.products.lamp.id, name: "Reported", status: "published", importKey: "e" }).returning();
    await reportReview(f.db, shop.id, reported!.id, "device-aaaaaaaaaaaaaaaa");

    const feed = await reviewFeedXml(f.db, shop, "https://glow.example");
    expect(feed).toContain("<version>2.3</version>");
    expect(feed).toContain(`<publisher><name>Glow Lamps</name></publisher>`);
    expect(feed.match(/<review>/g)).toHaveLength(2);
    for (const name of ["Hidden", "Waiting", "Draft product", "Reported"]) expect(feed).not.toContain(`>${name}<`);
    // Escaped, with the review's own link and the product it's about.
    expect(feed).toContain(`<name is_anonymous="false">Ada &lt;L&gt;</name>`);
    expect(feed).toContain("<content>Bright &amp; warm, a &quot;must&quot;.</content>");
    expect(feed).toContain(`<review_url type="singleton">https://glow.example/products/${f.products.lamp.handle}#review-${verified.id}</review_url>`);
    expect(feed).toContain(`<ratings><overall min="1" max="5">4</overall></ratings>`);
    expect(feed).toContain(`<product_name>Sunset Projection Lamp</product_name>`);
    expect(feed).toContain(`<brands><brand>Glow Lamps</brand></brands>`);
    const lampSkus = (await f.db.query.variants.findMany({ where: eq(schema.variants.productId, f.products.lamp.id) })).map((v) => v.sku).filter(Boolean);
    for (const sku of lampSkus) expect(feed).toContain(`<sku>${sku}</sku>`);
    // Only reviews from an order here say they were asked for after it shipped.
    expect(feed.match(/<collection_method>post_fulfillment<\/collection_method>/g)).toHaveLength(1);

    // An empty store still gives a valid, empty feed.
    const other = await makeFixture(new DemoModel());
    expect(await reviewFeedXml(other.db, await other.shop(), "https://x.example")).toContain("<reviews>\n\n</reviews>");
  });
});
