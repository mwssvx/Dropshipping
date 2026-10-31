import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { changeHandoverDay, DemoModel, moveHandoverDay, storeHandoverOptions, handoverDates, handoverDayOptions, sendHandoverReminders, setHandoverDays, setLocalPickup } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

describe("changing the pickup or delivery day", () => {
  it("lets the buyer move it to another open day until the day before, and tells the store", async () => {
    const f = await makeFixture(new DemoModel());
    const shop0 = await f.shop();
    await setLocalPickup(f.db, shop0.id, { address: "Glow Lamps Studio\n12 Congress Ave, Austin" });
    const days = (await setHandoverDays(f.db, shop0.id, { weekdays: [0, 1, 2, 3, 4, 5, 6], leadDays: 1, timeZone: "America/Chicago" }))!;
    const shop = await f.shop();
    const [first, second, third] = handoverDates(days);
    const placed = await f.waitingOrder();
    await f.db.update(schema.orders).set({ pickup: true, handoverOn: second, paidAt: new Date(Date.now() - 2 * DAY) }).where(eq(schema.orders.id, placed.id));
    const order = (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, placed.id) }))!;
    const ctx = { db: f.db, mailer: f.mailer, adminUrl: (p: string) => `https://admin.test${p}` };

    expect(handoverDayOptions(shop, order)).toEqual(handoverDates(days));
    await expect(changeHandoverDay(ctx, shop.id, order.id, "2020-01-01")).rejects.toThrow("Pick one of the days listed.");
    const moved = await changeHandoverDay(ctx, shop.id, order.id, third!);
    expect(moved.handoverOn).toBe(third);
    expect(moved.edits.at(-1)).toMatchObject({ by: "buyer", changes: [expect.stringMatching(/^Pickup day moved from .+ to .+$/)] });
    const told = f.mailer.sent.filter((m) => m.subject.startsWith(`Order #${order.number} at ${shop.name}: now collecting on`));
    expect(told.length).toBeGreaterThan(0);
    expect(told[0]!.text).toContain(`https://admin.test/admin/orders/${order.id}`);

    // The reminder goes out for the day it's on, and again if the buyer moves it.
    const dayBefore = (day: string) => ({ ...f.ctx, now: () => new Date(Date.parse(`${day}T12:00:00Z`) - DAY) });
    await f.db.update(schema.orders).set({ handoverOn: first }).where(eq(schema.orders.id, order.id));
    expect(await sendHandoverReminders(dayBefore(first!))).toEqual({ sent: 1 });
    await f.db.update(schema.orders).set({ handoverOn: third }).where(eq(schema.orders.id, order.id));
    expect(await sendHandoverReminders(dayBefore(third!))).toEqual({ sent: 1 });
    expect(await sendHandoverReminders(dayBefore(third!))).toEqual({ sent: 0 });

    // Not on the day itself, nor once it's handed over or for an order with no day.
    const onTheDay = new Date(Date.parse(`${third}T18:00:00Z`));
    expect(handoverDayOptions(shop, { ...order, handoverOn: third! }, onTheDay)).toBeNull();
    await expect(changeHandoverDay({ ...ctx, now: () => onTheDay }, shop.id, order.id, third!)).rejects.toThrow("can't be changed online any more");
    expect(handoverDayOptions(shop, { ...order, fulfillmentStatus: "delivered" })).toBeNull();
    expect(handoverDayOptions(shop, { ...order, handoverOn: null })).toBeNull();
    expect(handoverDayOptions({ handoverDays: null }, order)).toBeNull();
  });

  it("lets the store move it to any day in the window, today included, and emails the buyer", async () => {
    const f = await makeFixture(new DemoModel());
    const shop0 = await f.shop();
    await setLocalPickup(f.db, shop0.id, { address: "Glow Lamps Studio\n12 Congress Ave, Austin" });
    const days = (await setHandoverDays(f.db, shop0.id, { weekdays: [1, 3], leadDays: 2, timeZone: "America/Chicago" }))!;
    const shop = await f.shop();
    const placed = await f.waitingOrder();
    await f.db.update(schema.orders).set({ pickup: true, handoverOn: handoverDates(days)[0] }).where(eq(schema.orders.id, placed.id));
    const order = (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, placed.id) }))!;

    const options = storeHandoverOptions(shop, order)!;
    expect(options).toHaveLength(16);
    const today = options[0]!;
    await expect(moveHandoverDay(f.ctx, shop.id, order.id, "2020-01-01")).rejects.toThrow("Pick one of the days listed.");
    const moved = await moveHandoverDay(f.ctx, shop.id, order.id, today);
    expect(moved.handoverOn).toBe(today);
    expect(moved.edits.at(-1)).toMatchObject({ by: "merchant", changes: [expect.stringMatching(/^Pickup day moved from /)] });
    const mail = f.mailer.sent.find((m) => m.to === order.email && m.subject.startsWith(`New pickup day for order #${order.number} from ${shop.name}:`))!;
    expect(mail.text).toContain(`${shop.name} moved the day you collect order #${order.number} from`);
    const logged = await f.db.query.emails.findMany({ where: eq(schema.emails.kind, "handover_moved") });
    expect(logged.map((e) => e.ref)).toEqual([today]);

    await f.db.update(schema.orders).set({ fulfillmentStatus: "delivered" }).where(eq(schema.orders.id, order.id));
    await expect(moveHandoverDay(f.ctx, shop.id, order.id, options[3]!)).rejects.toThrow("This order has no day to move.");
  });
});
