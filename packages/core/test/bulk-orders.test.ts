import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createShop, DemoModel, packingSlips, signUp, tagOrders } from "../src";
import { makeFixture } from "../evals/fixture";

describe("bulk orders", () => {
  it("tags and untags the picked orders, skipping ones already done or with no room", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const a = await f.waitingOrder();
    const b = await f.waitingOrder();
    const c = await f.shippedOrder();
    await f.db.update(schema.orders).set({ tags: ["rush"] }).where(eq(schema.orders.id, b.id));
    await f.db.update(schema.orders).set({ tags: Array.from({ length: 10 }, (_, i) => `t${i}`) }).where(eq(schema.orders.id, c.id));

    expect(await tagOrders(f.db, shop.id, [a.id, b.id, c.id, a.id], { add: "  Rush " })).toEqual({ tag: "rush", changed: 1, full: 1 });
    const tagsOf = async (id: string) => (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, id) }))!.tags;
    expect(await tagsOf(a.id)).toEqual(["rush"]);
    expect(await tagsOf(c.id)).not.toContain("rush");

    expect(await tagOrders(f.db, shop.id, [a.id, b.id, c.id], { remove: "rush" })).toEqual({ tag: "rush", changed: 2, full: 0 });
    expect(await tagsOf(b.id)).toEqual([]);

    await expect(tagOrders(f.db, shop.id, [a.id], { add: " " })).rejects.toThrow("Enter a tag");
    await expect(tagOrders(f.db, shop.id, ["not-an-id"], { add: "x" })).rejects.toThrow("Pick at least one order");
    await expect(tagOrders(f.db, shop.id, Array.from({ length: 251 }, () => crypto.randomUUID()), { add: "x" })).rejects.toThrow("up to 250");

    // Another store's orders aren't touched.
    const user = await signUp(f.db, { email: "other@example.com", password: "correct horse" });
    const other = await createShop(f.db, user.id, { name: "Other", country: "US" });
    expect((await tagOrders(f.db, other.id, [a.id], { add: "mine" })).changed).toBe(0);
    expect(await tagsOf(a.id)).toEqual([]);
  });

  it("prints packing slips for just the picked orders", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const a = await f.waitingOrder();
    await f.waitingOrder();
    const c = await f.shippedOrder();
    const picked = await packingSlips(f.db, shop.id, { orderIds: [c.id, a.id, "junk"] });
    expect(picked.slips.map((s) => s.number)).toEqual([a.number, c.number]);
    const user = await signUp(f.db, { email: "other@example.com", password: "correct horse" });
    const other = await createShop(f.db, user.id, { name: "Other", country: "US" });
    expect((await packingSlips(f.db, other.id, { orderIds: [a.id] })).slips).toEqual([]);
  });
});
