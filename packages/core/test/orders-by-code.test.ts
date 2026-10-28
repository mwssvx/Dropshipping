import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { countOrders, createDiscount, DemoModel, ordersCsv, orderPage, saveView } from "../src";
import { makeFixture } from "../evals/fixture";

describe("orders by discount code", () => {
  it("lists only the orders that used the code", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp } = f.products;
    const summer = await createDiscount(f.db, shop.id, { code: "SUMMER20", kind: "percent", value: 20 });
    const [a, b] = [await f.order(lamp.id), await f.order(lamp.id)];
    await f.db.update(schema.orders).set({ discountId: summer.id }).where(eq(schema.orders.id, a.id));

    const numbers = async (discountId?: string) => (await orderPage(f.db, shop.id, { discountId })).orders.map((o) => o.number);
    expect(await numbers(summer.id)).toEqual([a.number]);
    expect((await numbers()).sort()).toEqual([a.number, b.number].sort());
    expect(await countOrders(f.db, shop.id, { discountId: summer.id })).toBe(1);
    // Not an id at all: no filter.
    expect((await numbers("SUMMER20")).length).toBe(2);
    const rows = (await ordersCsv(f.db, shop.id, { discountId: summer.id })).split("\n").slice(1).filter(Boolean);
    expect(rows.map((r) => r.split(",")[0])).toEqual([String(a.number)]);
    // A saved view keeps the code.
    expect((await saveView(f.db, shop.id, "orders", { name: "Summer orders", params: { code: summer.id } })).query).toBe(`code=${summer.id}`);
  });
});
