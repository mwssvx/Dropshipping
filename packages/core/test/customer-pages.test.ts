import { describe, expect, it } from "vitest";
import { schema } from "@sf/db";
import { customerTotals, DemoModel, listCustomers } from "../src";
import { makeFixture } from "../evals/fixture";

describe("customer list pages", () => {
  it("pages through every customer and counts all of them, not just one page", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const before = await customerTotals(f.db, shop.id);
    await f.db.insert(schema.customers).values(
      Array.from({ length: 7 }, (_, i) => ({ shopId: shop.id, email: `page-${i}@example.com`, name: `Page ${i}`, tags: i < 2 ? ["vip"] : [], lastSignInAt: i === 0 ? new Date() : null })),
    );
    // Only asked for the newsletter and never confirmed: not a customer yet.
    await f.db.insert(schema.customers).values({ shopId: shop.id, email: "lurker@example.com" });

    const totals = await customerTotals(f.db, shop.id);
    expect(totals.customers).toBe(before.customers + 7);
    expect(totals.accounts).toBe(before.accounts + 1);
    expect(totals.repeat).toBe(before.repeat);

    const all = await listCustomers(f.db, shop.id, { limit: 1000 });
    expect(all).toHaveLength(totals.customers);
    const pages = [];
    for (let offset = 0; offset < all.length; offset += 3) pages.push(...(await listCustomers(f.db, shop.id, { limit: 3, offset })));
    expect(pages.map((c) => c.id)).toEqual(all.map((c) => c.id));

    expect(await customerTotals(f.db, shop.id, { tag: "VIP" })).toMatchObject({ customers: 2 });
    expect((await customerTotals(f.db, shop.id, { query: "page-3" })).customers).toBe(1);
  });
});
