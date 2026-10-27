import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { countOrders, DemoModel, orderPage } from "../src";
import { makeFixture } from "../evals/fixture";

describe("order list pages", () => {
  it("pages through orders newest first, by number, with the filters applied", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await f.waitingOrder());
    const numbers = made.map((o) => o.number).sort((a, b) => b - a);

    const first = await orderPage(f.db, shop.id, {}, { size: 2 });
    expect(first.orders.map((o) => o.number)).toEqual(numbers.slice(0, 2));
    expect(first.older).toBe(numbers[1]);
    const second = await orderPage(f.db, shop.id, {}, { before: first.older!, size: 2 });
    expect(second.orders.map((o) => o.number)).toEqual(numbers.slice(2, 4));
    const last = await orderPage(f.db, shop.id, {}, { before: second.older!, size: 2 });
    expect(last.orders.map((o) => o.number)).toEqual(numbers.slice(4));
    expect(last.older).toBeNull();
    // Exactly a page's worth has no next page.
    expect((await orderPage(f.db, shop.id, {}, { size: 5 })).older).toBeNull();

    await f.db.update(schema.orders).set({ tags: ["rush"] }).where(eq(schema.orders.id, made[0]!.id));
    await f.db.update(schema.orders).set({ fulfillmentStatus: "problem" }).where(eq(schema.orders.id, made[1]!.id));
    expect((await orderPage(f.db, shop.id, { tag: "Rush" })).orders.map((o) => o.id)).toEqual([made[0]!.id]);
    expect(await countOrders(f.db, shop.id)).toBe(5);
    expect(await countOrders(f.db, shop.id, { fulfillmentStatus: "problem" })).toBe(1);
    expect(await countOrders(f.db, shop.id, { held: true })).toBe(0);
  });
});
