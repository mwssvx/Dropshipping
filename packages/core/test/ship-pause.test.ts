import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { activeShipPause, upcomingShipPause, DemoModel, exportStore, orderDelivery, productDelivery, sendLateOrderEmails, setLateOrderNotice, setShipPause, shippingStart } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

const day = (d: Date) => d.toISOString().slice(0, 10);

describe("shipping pause", () => {
  it("keeps orders coming in while dates count from when shipping resumes", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const now = f.ctx.now!();
    const in10 = day(new Date(now.getTime() + 10 * DAY));

    await expect(setShipPause(f.db, shop.id, { resumesOn: day(now) }, now)).rejects.toThrow("Pick a day after today");
    await expect(setShipPause(f.db, shop.id, { resumesOn: "2026-13-01" }, now)).rejects.toThrow("YYYY-MM-DD");
    await expect(setShipPause(f.db, shop.id, { resumesOn: day(new Date(now.getTime() + 60 * DAY)) }, now)).rejects.toThrow("up to 45 days");
    await expect(setShipPause(f.db, shop.id, { from: in10, resumesOn: in10 }, now)).rejects.toThrow("has to start before");

    const before = (await productDelivery(f.db, shop, f.products.lamp.id, { now }))!;
    expect(await setShipPause(f.db, shop.id, { resumesOn: in10, message: "  Our supplier is closed for New Year. " }, now)).toEqual({ from: day(now), resumesOn: in10, message: "Our supplier is closed for New Year." });
    const paused = await f.shop();
    const resumes = new Date(`${in10}T00:00:00Z`);
    expect(activeShipPause(paused, now)).toMatchObject({ resumesOn: in10, resumes });
    expect(shippingStart(paused, now)).toEqual(resumes);
    // Product pages count from the day shipping resumes.
    const during = (await productDelivery(f.db, paused, f.products.lamp.id, { now }))!;
    expect(during.from.getTime()).toBe(resumes.getTime() + (before.from.getTime() - now.getTime()));
    // So does an order paid now.
    const order = await f.waitingOrder();
    const arrives = (await orderDelivery(f.db, paused, order))!;
    expect(arrives.from.getTime()).toBeGreaterThanOrEqual(resumes.getTime());
    // Ends by itself.
    expect(activeShipPause(paused, resumes)).toBeNull();
    expect(shippingStart(paused, new Date(resumes.getTime() + DAY)).getTime()).toBe(resumes.getTime() + DAY);

    // Running late emails wait while it's on, and count from when it ends.
    await setLateOrderNotice(f.db, shop.id, { days: 3 });
    await f.db.update(schema.orders).set({ paidAt: new Date(now.getTime() - DAY) }).where(eq(schema.orders.id, order.id));
    const at = (ms: number) => ({ ...f.ctx, now: () => new Date(ms) });
    expect(await sendLateOrderEmails(at(now.getTime() + 5 * DAY))).toMatchObject({ sent: 0 });
    expect(await sendLateOrderEmails(at(resumes.getTime() + DAY))).toMatchObject({ sent: 1 });

    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shop.id)));
    expect(file.store.ship_pause).toEqual({ from: day(now), resumesOn: in10, message: "Our supplier is closed for New Year." });

    // Set ahead: nothing changes until it starts.
    const in20 = day(new Date(now.getTime() + 20 * DAY));
    const ahead = await setShipPause(f.db, shop.id, { from: in10, resumesOn: in20 }, now);
    expect(ahead).toMatchObject({ from: in10, resumesOn: in20 });
    expect(activeShipPause(await f.shop(), now)).toBeNull();
    expect(activeShipPause(await f.shop(), new Date(resumes.getTime() + 3_600_000))).not.toBeNull();
    // Warned about from a week before: the last day to order is the day before it starts.
    expect(upcomingShipPause(await f.shop(), now)).toBeNull();
    expect(upcomingShipPause(await f.shop(), new Date(now.getTime() + 4 * DAY))).toMatchObject({ lastDay: day(new Date(now.getTime() + 9 * DAY)), resumesOn: in20 });
    expect(upcomingShipPause(await f.shop(), new Date(resumes.getTime() + 3_600_000))).toBeNull();
    expect(upcomingShipPause(paused, now)).toBeNull();
    expect(await setShipPause(f.db, shop.id, null, now)).toBeNull();
  });
});
