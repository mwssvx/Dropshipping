import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema } from "@sf/db";
import { countOrders, DemoModel, ordersCsv, orderPage, saveView, totalParam } from "../src";
import { makeFixture } from "../evals/fixture";

describe("orders by total", () => {
  it("lists the orders whose total falls in the range", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp } = f.products;
    const orders = [];
    // $9.99, $25.00 (the edge goes up a range), $99.99, $250.00.
    for (const totalMinor of [999, 2500, 9999, 25000]) {
      const o = await f.order(lamp.id);
      // Shipping and the rest kept, so the order still adds up.
      await f.db.update(schema.orders).set({ subtotalMinor: sql`${schema.orders.subtotalMinor} + ${totalMinor} - ${schema.orders.totalMinor}`, totalMinor }).where(eq(schema.orders.id, o.id));
      orders.push(o.number);
    }
    const numbers = async (total?: string) => (await orderPage(f.db, shop.id, { total: totalParam(total) })).orders.map((o) => o.number).sort();
    expect(await numbers("under-25")).toEqual([orders[0]]);
    expect(await numbers("25-100")).toEqual([orders[1], orders[2]].sort());
    expect(await numbers("100-250")).toEqual([]);
    expect(await numbers("over-250")).toEqual([orders[3]]);
    // Not a range: no filter.
    expect(totalParam("lots")).toBeUndefined();
    expect(totalParam("toString")).toBeUndefined();
    expect((await numbers("lots")).length).toBe(4);
    expect(await countOrders(f.db, shop.id, { total: "25-100" })).toBe(2);
    const rows = (await ordersCsv(f.db, shop.id, { total: "over-250" })).split("\n").slice(1).filter(Boolean);
    expect(rows.map((r) => r.split(",")[0])).toEqual([String(orders[3])]);
    // A saved view keeps the range.
    expect((await saveView(f.db, shop.id, "orders", { name: "Big orders", params: { total: "over-250" } })).query).toBe("total=over-250");
  });
});
