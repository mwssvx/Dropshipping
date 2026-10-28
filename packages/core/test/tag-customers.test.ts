import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createShop, DemoModel, listCustomers, signUp, tagCustomers } from "../src";
import { makeFixture } from "../evals/fixture";

describe("tag everyone in the customer list", () => {
  it("adds and removes a tag on everyone the list shows, on every page", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const a = await f.order(f.products.lamp.id);
    const again = await f.order(f.products.lamp.id);
    await f.db.update(schema.orders).set({ email: a.email }).where(eq(schema.orders.id, again.id));
    await f.db.insert(schema.customers).values([
      { shopId: shop.id, email: "fan@example.com", name: "Fan", acceptsMarketing: true, tags: ["early"] },
      { shopId: shop.id, email: "full@example.com", name: "Full", acceptsMarketing: true, tags: Array.from({ length: 10 }, (_, i) => `t${i}`) },
    ]);
    const tags = async (email: string) => (await f.db.query.customers.findFirst({ where: (c, { and, eq }) => and(eq(c.shopId, shop.id), eq(c.email, email)) }))!.tags;

    await expect(tagCustomers(f.db, shop.id, {}, { tag: "a, b" })).rejects.toThrow("one tag at a time");
    await expect(tagCustomers(f.db, shop.id, {}, { tag: " " })).rejects.toThrow("Enter the tag");

    // Only the subscribers; the one with 10 tags is left out.
    expect(await tagCustomers(f.db, shop.id, { filter: "subscribed" }, { tag: " Newsletter " })).toEqual({ tag: "newsletter", changed: 1, full: 1 });
    expect(await tags("fan@example.com")).toEqual(["early", "newsletter"]);
    expect(await tags("full@example.com")).not.toContain("newsletter");
    expect(await tags(a.email)).toEqual([]);
    // Twice changes nothing.
    expect((await tagCustomers(f.db, shop.id, { filter: "subscribed" }, { tag: "newsletter" })).changed).toBe(0);

    // Repeat buyers, found by the same filter as the list.
    expect((await tagCustomers(f.db, shop.id, { filter: "repeat" }, { tag: "loyal" })).changed).toBe(1);
    expect((await listCustomers(f.db, shop.id, { tag: "loyal" })).map((c) => c.email)).toEqual([a.email]);

    // Removing also stops a rule from tracking it.
    await f.db.update(schema.customers).set({ autoTags: ["loyal"] }).where(eq(schema.customers.email, a.email));
    expect((await tagCustomers(f.db, shop.id, { tag: "loyal" }, { tag: "loyal", remove: true })).changed).toBe(1);
    const row = await f.db.query.customers.findFirst({ where: eq(schema.customers.email, a.email) });
    expect([row!.tags, row!.autoTags]).toEqual([[], []]);

    // Never another store's customers.
    const user = await signUp(f.db, { email: "other@example.com", password: "correct horse" });
    const other = await createShop(f.db, user.id, { name: "Other", country: "US" });
    await f.db.insert(schema.customers).values({ shopId: other.id, email: "fan@example.com", acceptsMarketing: true });
    await tagCustomers(f.db, shop.id, { filter: "subscribed" }, { tag: "mine" });
    const theirs = await f.db.query.customers.findFirst({ where: eq(schema.customers.shopId, other.id) });
    expect(theirs!.tags).toEqual([]);
  });
});
