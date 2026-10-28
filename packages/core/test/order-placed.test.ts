import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { countOrders, DemoModel, orderPage, ORDER_PLACED_DAYS, placedSince, viewQuery } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

describe("orders placed in the last N days", () => {
  it("only takes the offered ranges", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    expect(ORDER_PLACED_DAYS).toEqual([7, 30, 90, 365]);
    expect(placedSince("7", now)).toEqual(new Date("2026-10-21T12:00:00Z"));
    expect(placedSince(365, now)).toEqual(new Date("2025-10-28T12:00:00Z"));
    for (const bad of ["", "5", "abc", null, undefined, "-7"]) expect(placedSince(bad, now)).toBeUndefined();
    // Saved views keep the range.
    expect(viewQuery("orders", { placed: "30", country: "GB" })).toBe("country=GB&placed=30");
  });

  it("filters the order list", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const fresh = await f.order(f.products.lamp.id);
    const month = await f.order(f.products.lamp.id);
    const old = await f.order(f.products.lamp.id);
    const back = (id: string, days: number) => f.db.update(schema.orders).set({ createdAt: new Date(Date.now() - days * DAY) }).where(eq(schema.orders.id, id));
    await back(month.id, 20);
    await back(old.id, 200);
    const numbers = async (days?: number) => (await orderPage(f.db, shop.id, { from: placedSince(days) })).orders.map((o) => o.id);
    expect(await numbers(7)).toEqual([fresh.id]);
    // Newest number first.
    expect(await numbers(30)).toEqual([month.id, fresh.id]);
    expect((await numbers(365)).length).toBe(3);
    expect(await countOrders(f.db, shop.id, { from: placedSince(90) })).toBe(2);
  });
});
