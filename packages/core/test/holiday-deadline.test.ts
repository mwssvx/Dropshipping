import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createProduct, createShop, deliveryWindow, DemoModel, exportStore, holidayOrderBy, importStore, productDelivery, setDeliveryEstimates, setHolidayDeadline, signUp } from "../src";
import { makeFixture } from "../evals/fixture";

const DAY = 86_400_000;
const day = (d: Date | null | undefined) => d?.toISOString().slice(0, 10) ?? null;
const christmas = { name: "Christmas", arriveBy: "2026-12-24" };
const ny = { hour: 14, timeZone: "America/New_York", weekends: false };

describe("holiday deadline", () => {
  it("works out the last day to order so even the slowest delivery makes it", () => {
    const at = (iso: string, processingDays: number, transitMax: number, cutoff = null as typeof ny | null) => {
      const now = new Date(iso);
      return holidayOrderBy(christmas, deliveryWindow(now, processingDays, 1, transitMax, cutoff), cutoff, now);
    };
    // Two days to process and up to five in transit: an order late on Dec 17 still lands on the 24th.
    expect(day(at("2026-10-28T10:00:00Z", 2, 5)!.orderBy)).toBe("2026-12-17");
    expect(at("2026-10-28T10:00:00Z", 2, 5)!.today).toBe(false);
    expect(at("2026-12-17T23:00:00Z", 2, 5)).toMatchObject({ orderBy: new Date("2026-12-17"), today: true });
    // From the 18th it may not make it, and after the 24th there's nothing to say.
    expect(at("2026-12-18T00:30:00Z", 2, 5)).toMatchObject({ name: "Christmas", orderBy: null });
    expect(day(at("2026-12-18T00:30:00Z", 2, 5)!.arriveBy)).toBe("2026-12-24");
    expect(at("2026-12-25T01:00:00Z", 2, 5)).toBeNull();
    expect(holidayOrderBy(null, deliveryWindow(new Date(), 2, 1, 5), null, new Date())).toBeNull();

    // With a 2 pm cutoff and no weekend shipping, an order by Sunday the 20th leaves on Monday and
    // arrives Thursday the 24th; a Monday order after 2 pm leaves Tuesday and is too late.
    expect(day(at("2026-11-02T15:00:00Z", 0, 3, ny)!.orderBy)).toBe("2026-12-20");
    // On Monday morning there's still time, until the cutoff.
    expect(at("2026-12-21T15:00:00Z", 0, 3, ny)).toMatchObject({ orderBy: new Date("2026-12-21"), today: true });
    expect(at("2026-12-21T20:00:00Z", 0, 3, ny)!.orderBy).toBeNull();
  });

  it("shows on product pages once set, checks the day, and goes with the store file", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    await setDeliveryEstimates(f.db, shopId, { enabled: true, processingDays: 2 });
    const mug = await createProduct(f.db, shopId, { title: "Mug", status: "active", variants: [{ title: "Default", priceMinor: 1500, stock: 9 }] });
    await f.db.update(schema.variants).set({ shipDaysMin: 3, shipDaysMax: 5 }).where(eq(schema.variants.productId, mug.id));
    const now = new Date("2026-10-28T10:00:00Z");
    expect((await productDelivery(f.db, await f.shop(), mug.id, { now }))!.holiday).toBeNull();

    const today = new Date();
    const inDays = (n: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) + n * DAY).toISOString().slice(0, 10);
    expect(await setHolidayDeadline(f.db, shopId, { name: "  Mother's   Day ", arriveBy: inDays(30) })).toEqual({ name: "Mother's Day", arriveBy: inDays(30) });
    await expect(setHolidayDeadline(f.db, shopId, { name: " ", arriveBy: inDays(30) })).rejects.toThrow("Name the day");
    await expect(setHolidayDeadline(f.db, shopId, { name: "x".repeat(41), arriveBy: inDays(30) })).rejects.toThrow("under 40 characters");
    await expect(setHolidayDeadline(f.db, shopId, { name: "Christmas", arriveBy: "2026-02-30" })).rejects.toThrow("Pick the last day");
    await expect(setHolidayDeadline(f.db, shopId, { name: "Christmas", arriveBy: inDays(0) })).rejects.toThrow("after today");
    await expect(setHolidayDeadline(f.db, shopId, { name: "Christmas", arriveBy: inDays(366) })).rejects.toThrow("within a year");

    await setHolidayDeadline(f.db, shopId, christmas, now);
    const shown = (await productDelivery(f.db, await f.shop(), mug.id, { now }))!;
    // The same slowest days the page shows: processing, then the longest transit.
    expect(shown.holiday).toMatchObject({ name: "Christmas" });
    expect(day(shown.holiday!.orderBy)).toBe(day(new Date(Date.UTC(2026, 11, 24) - (shown.processingDays + shown.transitMax) * DAY)));

    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shopId)));
    expect(file.store.holiday_deadline).toEqual(christmas);
    const owner = await signUp(f.db, { email: "holiday-copy@example.com", password: "correct horse battery" });
    const copy = await createShop(f.db, owner.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, file);
    expect((await f.db.query.shops.findFirst({ where: eq(schema.shops.id, copy.id) }))!.holidayDeadline).toEqual(christmas);

    expect(await setHolidayDeadline(f.db, shopId, null)).toBeNull();
    expect((await productDelivery(f.db, await f.shop(), mug.id, { now }))!.holiday).toBeNull();
  });
});
