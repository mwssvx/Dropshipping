import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { canMarkArrived, DemoModel, markArrivedByBuyer, ordersPastDelivery, sendLateOrderEmails, setLateOrderNotice } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

describe("buyers mark their order arrived", () => {
  it("makes a shipped order delivered, once, with no email", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const waiting = await f.waitingOrder();
    expect(canMarkArrived(waiting)).toBe(false);
    await expect(markArrivedByBuyer(f.db, shop.id, waiting.id)).rejects.toThrow("can't be marked as arrived yet");
    await expect(markArrivedByBuyer(f.db, shop.id, "00000000-0000-0000-0000-000000000000")).rejects.toThrow();

    const shipped = await f.shippedOrder();
    expect(canMarkArrived(shipped)).toBe(true);
    expect(canMarkArrived({ ...shipped, pickup: true })).toBe(false);
    const [parcel] = await f.db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, shipped.id) });
    const shippedAt = parcel!.shippedAt!.getTime();
    expect(await ordersPastDelivery(f.db, shop, new Date(shippedAt + 12 * DAY))).toHaveLength(1);

    const sentBefore = f.mailer.sent.length;
    const at = new Date(shippedAt + 12 * DAY);
    const done = await markArrivedByBuyer(f.db, shop.id, shipped.id, at);
    expect(done.fulfillmentStatus).toBe("delivered");
    expect(done.edits.at(-1)).toMatchObject({ by: "buyer", changes: ["Said it arrived"] });
    const [after] = await f.db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, shipped.id) });
    expect(after).toMatchObject({ status: "delivered", deliveredAt: at });
    expect(f.mailer.sent.length).toBe(sentBefore);
    // Pressing again changes nothing.
    expect((await markArrivedByBuyer(f.db, shop.id, shipped.id)).edits).toHaveLength(done.edits.length);

    // No longer late, and no "still on its way" email.
    expect(await ordersPastDelivery(f.db, shop, new Date(shippedAt + 12 * DAY))).toEqual([]);
    await setLateOrderNotice(f.db, shop.id, { days: 7, transit: true });
    expect(await sendLateOrderEmails({ ...f.ctx, now: () => new Date(shippedAt + 12 * DAY) })).toMatchObject({ transit: 0 });
  });
});
