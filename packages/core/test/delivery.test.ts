import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { daysPastDelivery, DemoModel, exportStore, formatDeliveryWindow, orderDelivery, productDelivery, setDeliveryEstimates, transitDays } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

describe("delivery dates", () => {
  it("never promises faster than the supplier ships", () => {
    const supplier = [{ shipDaysMin: 6, shipDaysMax: 10 }];
    expect(transitDays(supplier, { minDays: 2, maxDays: 4 })).toEqual({ min: 6, max: 10 });
    expect(transitDays(supplier, { minDays: 7, maxDays: 20 })).toEqual({ min: 7, max: 20 });
    expect(transitDays(supplier, null)).toEqual({ min: 6, max: 10 });
    expect(transitDays([{ shipDaysMin: null, shipDaysMax: null }], { minDays: 5, maxDays: 10 })).toEqual({ min: 5, max: 10 });
    expect(transitDays([{ shipDaysMin: null, shipDaysMax: 12 }, { shipDaysMin: 3, shipDaysMax: 8 }], null)).toEqual({ min: 12, max: 12 });
    expect(transitDays([{ shipDaysMin: null, shipDaysMax: null }], { minDays: null, maxDays: null })).toBeNull();
    const at = new Date("2026-10-10T12:00:00Z");
    expect(formatDeliveryWindow({ from: at, to: new Date(at.getTime() + 7 * DAY) })).toBe("Oct 10 – Oct 17");
    expect(formatDeliveryWindow({ from: at, to: at })).toBe("Oct 10");
  });

  it("shows when a product and an order should arrive", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const now = f.ctx.now!();
    // The demo supplier says 6 to 10 days; the store takes 2 days to send it on.
    const product = (await productDelivery(f.db, await f.shop(), f.products.lamp.id, { country: "US", now }))!;
    expect(product).toMatchObject({ processingDays: 2, transitMin: 6, transitMax: 10, country: "US" });
    expect(product.from.getTime()).toBe(now.getTime() + 8 * DAY);
    expect(product.to.getTime()).toBe(now.getTime() + 12 * DAY);

    await expect(setDeliveryEstimates(f.db, shopId, { enabled: true, processingDays: 15 })).rejects.toThrow("between 0 and 14 days");
    await setDeliveryEstimates(f.db, shopId, { enabled: true, processingDays: 3 });
    expect((await productDelivery(f.db, await f.shop(), f.products.lamp.id, { now }))!.from.getTime()).toBe(now.getTime() + 9 * DAY);

    // Paid: counted from payment, and on the receipt.
    const order = await f.waitingOrder();
    const paid = (await orderDelivery(f.db, await f.shop(), order))!;
    expect(paid.from.getTime()).toBe(order.paidAt!.getTime() + 9 * DAY);
    expect(paid.to.getTime()).toBe(order.paidAt!.getTime() + 13 * DAY);
    const receipt = f.mailer.sent.find((m) => m.subject === `Order #${order.number} confirmed`);
    expect(receipt?.text).toContain(`Expected delivery: ${formatDeliveryWindow(paid)}.`);

    // Shipped: only transit is left, counted from the shipment.
    const shipped = await f.shippedOrder();
    expect(shipped.fulfillmentStatus).toBe("shipped");
    const [fulfillment] = await f.db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, shipped.id) });
    const onTheWay = (await orderDelivery(f.db, await f.shop(), shipped))!;
    expect(onTheWay.processingDays).toBe(0);
    expect(onTheWay.from.getTime()).toBe(fulfillment!.shippedAt!.getTime() + 6 * DAY);

    // Delivered or turned off: no dates.
    expect(await orderDelivery(f.db, await f.shop(), { ...shipped, fulfillmentStatus: "delivered" })).toBeNull();
    await setDeliveryEstimates(f.db, shopId, { enabled: false, processingDays: 3 });
    expect(await productDelivery(f.db, await f.shop(), f.products.lamp.id)).toBeNull();
    const quiet = await f.waitingOrder();
    expect(f.mailer.sent.find((m) => m.subject === `Order #${quiet.number} confirmed`)?.text).not.toContain("Expected delivery");

    // The admin still sees the date with it turned off, and how late a shipped parcel is.
    const hidden = (await orderDelivery(f.db, await f.shop(), shipped, { evenIfHidden: true }))!;
    expect(hidden.to.getTime()).toBe(onTheWay.to.getTime());
    expect(await orderDelivery(f.db, await f.shop(), shipped)).toBeNull();
    expect(daysPastDelivery(hidden, shipped, new Date(hidden.to.getTime() + DAY / 2))).toBe(0);
    expect(daysPastDelivery(hidden, shipped, new Date(hidden.to.getTime() + 3 * DAY + 5))).toBe(3);
    expect(daysPastDelivery(hidden, { fulfillmentStatus: "unfulfilled" }, new Date(hidden.to.getTime() + 3 * DAY))).toBe(0);
    expect(daysPastDelivery(null, shipped)).toBe(0);

    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shopId)));
    expect(file.store.delivery_estimates).toEqual({ enabled: false, processing_days: 3 });
  });
});
