import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, recentSalesCount, RECENT_SALES_MIN, setRecentSales } from "../src";
import { makeFixture } from "../evals/fixture";

const DAY = 86_400_000;

describe("recent sales on product pages", () => {
  it("counts units in paid orders from the last week, and hides small numbers", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp, projector } = f.products;
    expect(shop.recentSales).toBe(false);
    expect(await setRecentSales(f.db, shop.id, true)).toBe(true);
    expect((await f.db.query.shops.findFirst({ where: eq(schema.shops.id, shop.id) }))!.recentSales).toBe(true);

    expect(RECENT_SALES_MIN).toBe(3);
    const orders = [await f.order(lamp.id), await f.order(lamp.id)];
    // Two isn't worth saying.
    expect(await recentSalesCount(f.db, shop.id, lamp.id)).toBeNull();
    orders.push(await f.order(lamp.id), await f.order(lamp.id));
    expect(await recentSalesCount(f.db, shop.id, lamp.id)).toBe(4);
    // Another product's sales don't count.
    await f.order(projector.id).catch(() => null);
    expect(await recentSalesCount(f.db, shop.id, lamp.id)).toBe(4);
    // Refunded and old orders don't count.
    await f.db.update(schema.orders).set({ paymentStatus: "refunded" }).where(eq(schema.orders.id, orders[0]!.id));
    expect(await recentSalesCount(f.db, shop.id, lamp.id)).toBe(3);
    await f.db.update(schema.orders).set({ paidAt: new Date(Date.now() - 8 * DAY) }).where(eq(schema.orders.id, orders[1]!.id));
    expect(await recentSalesCount(f.db, shop.id, lamp.id)).toBeNull();
    // A week later, nothing.
    expect(await recentSalesCount(f.db, shop.id, lamp.id, new Date(Date.now() + 8 * DAY))).toBeNull();
  });
});
