import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, ordersPastDelivery, setDeliveryEstimates } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

describe("orders past their delivery date", () => {
  it("lists shipped orders a day after their window ends, most late first", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const first = await f.shippedOrder();
    const [parcel] = await f.db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, first.id) });
    const shippedAt = parcel!.shippedAt!.getTime();
    // The demo supplier says 6 to 10 days once it's shipped.
    expect(await ordersPastDelivery(f.db, shop, new Date(shippedAt + 10 * DAY))).toEqual([]);
    expect(await ordersPastDelivery(f.db, shop, new Date(shippedAt + 10.5 * DAY))).toEqual([]);

    const second = await f.shippedOrder();
    // Left out: still to ship, delivered, refunded, picked up.
    await f.waitingOrder();
    const delivered = await f.shippedOrder();
    await f.db.update(schema.orders).set({ fulfillmentStatus: "delivered" }).where(eq(schema.orders.id, delivered.id));
    const refunded = await f.shippedOrder();
    await f.db.update(schema.orders).set({ paymentStatus: "refunded" }).where(eq(schema.orders.id, refunded.id));
    const pickup = await f.shippedOrder();
    await f.db.update(schema.orders).set({ pickup: true }).where(eq(schema.orders.id, pickup.id));

    const late = await ordersPastDelivery(f.db, shop, new Date(shippedAt + 14 * DAY));
    expect(late.map((o) => o.number)).toEqual([first.number, second.number]);
    expect(late[0]).toMatchObject({ id: first.id, email: first.email, name: first.shippingAddress.name, country: first.shippingAddress.country, daysLate: 4 });
    expect(late[0]!.expected.getTime()).toBe(shippedAt + 10 * DAY);
    expect(late[1]!.daysLate).toBeLessThan(4);

    // Counted even when buyers aren't shown dates.
    await setDeliveryEstimates(f.db, shop.id, { enabled: false, processingDays: 2 });
    expect(await ordersPastDelivery(f.db, await f.shop(), new Date(shippedAt + 14 * DAY))).toHaveLength(2);
    // Long-gone orders drop off.
    expect(await ordersPastDelivery(f.db, await f.shop(), new Date(shippedAt + 200 * DAY))).toEqual([]);
  });
});
