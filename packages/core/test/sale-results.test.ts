import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, saleResults } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

describe("sale results", () => {
  it("counts what a sale sold over its days, against the days just before it", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const now = new Date();
    const paidAt = async (o: { id: string }, daysAgo: number) => {
      await f.db.update(schema.orders).set({ paidAt: new Date(now.getTime() - daysAgo * DAY) }).where(eq(schema.orders.id, o.id));
    };
    const lampOrder = await f.waitingOrder();
    const [line] = await f.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, lampOrder.id) });
    const price = line!.unitPriceMinor;
    await paidAt(lampOrder, 2);
    await paidAt(await f.waitingOrder(), 1.5);
    await paidAt(await f.waitingOrder(), 4);
    await paidAt(await f.outOfStockOrder(), 2);

    const [lampSale, everything, upcoming] = await f.db
      .insert(schema.sales)
      .values([
        { shopId, title: "Lamp days", percentOff: 20, scope: "products", productIds: [f.products.lamp.id], startsAt: new Date(now.getTime() - 3 * DAY), endsAt: new Date(now.getTime() - DAY) },
        { shopId, title: "Everything", percentOff: 10, scope: "all", startsAt: new Date(now.getTime() - 3 * DAY), endsAt: null },
        { shopId, title: "Later", percentOff: 10, scope: "all", startsAt: new Date(now.getTime() + DAY), endsAt: null },
      ])
      .returning();

    const results = await saleResults(f.db, shopId, [lampSale!, everything!, upcoming!], now);
    expect(results.get(lampSale!.id)).toEqual({ days: 2, orders: 2, units: 2, salesMinor: 2 * price, beforeMinor: price, lift: 2 });
    // Still running: three days so far, and the galaxy projector is on sale too.
    expect(results.get(everything!.id)).toMatchObject({ days: 3, orders: 3, units: 3 });
    expect(results.has(upcoming!.id)).toBe(false);
  });
});
