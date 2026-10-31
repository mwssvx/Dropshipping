import { describe, expect, it } from "vitest";
import { schema } from "@sf/db";
import { DemoModel, importReviews, parseCsv, reviewsCsv, submitReview } from "../src";
import { makeFixture } from "../evals/fixture";

describe("downloading reviews", () => {
  it("writes the Shopify Product Reviews columns, follows the filters, and imports back", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = { ...(await f.shop()), reviewsAutoPublish: true };
    const order = await f.shippedOrder();
    await submitReview(f.db, shop, order.paymentIntentId!, { productId: f.products.lamp.id, rating: 5, name: "Ada L.", body: '=1+1 "quoted", and\na new line' });
    await f.db.insert(schema.reviews).values({ shopId: shop.id, productId: f.products.lamp.id, name: "Old Buyer", rating: 2, body: "Too dim for me.", status: "hidden", reply: "Sorry!", importKey: "x1", createdAt: new Date("2025-01-02T03:04:05Z") });
    const opts = { emails: true, photoUrl: (id: string) => `https://shop.example/api/media/${id}` };

    const [header, ...rows] = parseCsv(await reviewsCsv(f.db, shop.id, opts)).filter((r) => r.some(Boolean));
    expect(header!.slice(0, 11)).toEqual(["product_handle", "state", "rating", "title", "author", "email", "location", "body", "reply", "created_at", "replied_at"]);
    expect(rows).toHaveLength(2);
    const ada = rows.find((r) => r[4] === "Ada L.")!;
    // A spreadsheet won't run it as a formula; quotes, commas and new lines survive.
    expect(ada.slice(0, 9)).toEqual([f.products.lamp.handle, "published", "5", "", "Ada L.", order.email, "", `'=1+1 "quoted", and\na new line`, ""]);
    expect(ada[12]).toBe(String(order.number));
    const old = rows.find((r) => r[4] === "Old Buyer")!;
    expect(old.slice(1, 3)).toEqual(["unpublished", "2"]);
    expect(old[8]).toBe("Sorry!");
    expect(old[9]).toBe("2025-01-02T03:04:05.000Z");

    // Filters, and no emails for staff who can't see customers.
    const hidden = parseCsv(await reviewsCsv(f.db, shop.id, { ...opts, status: "hidden" })).filter((r) => r.some(Boolean));
    expect(hidden.slice(1).map((r) => r[4])).toEqual(["Old Buyer"]);
    const noEmails = parseCsv(await reviewsCsv(f.db, shop.id, { ...opts, emails: false })).filter((r) => r.some(Boolean));
    expect(noEmails.slice(1).every((r) => r[5] === "")).toBe(true);

    // Brought back into the same store, nothing is doubled, the merchant's own reviews included.
    const again = await importReviews(f.db, shop.id, await reviewsCsv(f.db, shop.id, opts));
    expect(again).toMatchObject({ format: "Shopify Product Reviews", added: 0, alreadyHere: 2, unusable: 0 });
    // Into another store with the same product, both come over with their stars, replies and state.
    const other = await makeFixture(new DemoModel());
    const otherShop = await other.shop();
    const moved = await importReviews(other.db, otherShop.id, (await reviewsCsv(f.db, shop.id, opts)).replaceAll(f.products.lamp.handle, other.products.lamp.handle));
    expect(moved).toMatchObject({ added: 2, unusable: 0 });
    const there = await other.db.query.reviews.findMany({ orderBy: schema.reviews.rating });
    expect(there.map((r) => [r.name, r.rating, r.status, r.reply])).toEqual([["Old Buyer", 2, "hidden", "Sorry!"], ["Ada L.", 5, "published", null]]);
  });
});
