import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createGiftCardProduct, createGiftGuides, createSale, DemoModel, scheduleTheme, holidayChecklist, holidaySeason, setHolidayDeadline, setHolidayReturns, setLateOrderNotice } from "../src";
import { makeFixture } from "../evals/fixture";

const now = new Date("2026-10-28T12:00:00Z");

describe("holiday checklist", () => {
  it("ticks each holiday setting from the store's own state", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const done = async () => Object.fromEntries((await holidayChecklist(f.db, await f.shop(), now)).map((c) => [c.key, c.done]));
    expect(await done()).toEqual({
      delivery: true,
      "order-by": false,
      returns: false,
      "gift-cards": false,
      "gift-guides": false,
      "gift-wrap": false,
      sale: false,
      look: false,
      reminders: true,
      popup: false,
      late: false,
      backups: true,
    });

    // A best seller from a supplier with no backup.
    await f.waitingOrder();
    const backups = async () => (await holidayChecklist(f.db, await f.shop(), new Date())).find((c) => c.key === "backups")!;
    expect(await backups()).toMatchObject({ done: false, detail: "Sunset Projection Lamp has no backup if the supplier runs out.", href: `/admin/products/${f.products.lamp.id}#backup-heading` });
    await f.db.update(schema.products).set({ backup: { supplierId: "x", sourceUrl: "https://example.com/x", productRef: "x", variants: {}, checkedAt: now.toISOString() } }).where(eq(schema.products.id, f.products.lamp.id));
    expect((await backups()).done).toBe(true);

    await setHolidayDeadline(f.db, shop.id, { name: "Christmas", arriveBy: "2026-12-24" }, now);
    await setHolidayReturns(f.db, shop, { from: "2026-11-01", to: "2026-12-24", until: "2027-01-31" }, now);
    await createGiftCardProduct(f.db, shop, [2500, 5000]);
    await f.db.update(schema.shops).set({ giftWrap: { priceMinor: 300, note: null }, signupPopupSeconds: 5 }).where(eq(schema.shops.id, shop.id));
    await createSale(f.db, shop.id, { title: "Black Friday", percentOff: 20, scope: "all", startsAt: new Date("2026-11-27T05:00:00Z"), endsAt: new Date("2026-11-30T05:00:00Z") }, now);
    await setLateOrderNotice(f.db, shop.id, { days: 7 });
    await createGiftGuides(f.db, shop);
    await scheduleTheme(f.db, shop, { at: new Date("2026-11-27T05:00:00Z"), until: new Date("2026-12-01T05:00:00Z") }, now);
    const list = await holidayChecklist(f.db, await f.shop(), now);
    expect(list.every((c) => c.done)).toBe(true);
    expect(list.find((c) => c.key === "order-by")!.detail).toBe("Product pages count back from Dec 24 for Christmas.");
    expect(list.find((c) => c.key === "look")!.detail).toBe("A new look goes live by itself and switches back after.");
    expect(list.find((c) => c.key === "returns")!.detail).toBe("Orders from Nov 1 to Dec 24 can come back until Jan 31.");

    // After the holiday, its date no longer counts.
    expect((await holidayChecklist(f.db, await f.shop(), new Date("2026-12-26T12:00:00Z"))).find((c) => c.key === "order-by")!.done).toBe(false);
  });

  it("shows on the home page from October to Christmas Eve", () => {
    expect(holidaySeason(new Date("2026-09-30T12:00:00Z"))).toBe(false);
    expect(holidaySeason(new Date("2026-10-01T00:00:00Z"))).toBe(true);
    expect(holidaySeason(new Date("2026-12-24T20:00:00Z"))).toBe(true);
    expect(holidaySeason(new Date("2026-12-25T00:00:00Z"))).toBe(false);
  });
});
