import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createProduct, DemoModel, nextCutoff, productDelivery, setDeliveryEstimates, setShipCutoff, shipDay } from "../src";
import { makeFixture } from "../evals/fixture";

const ny = { hour: 14, timeZone: "America/New_York", weekends: false };
const day = (d: Date) => d.toISOString().slice(0, 10);

describe("same-day cutoff", () => {
  it("ships today before the cutoff, the next shipping day after it, and skips weekends", () => {
    // Wednesday 10:00 in New York.
    const wedMorning = new Date("2026-10-28T14:00:00Z");
    expect(day(shipDay(wedMorning, 0, ny))).toBe("2026-10-28");
    expect(nextCutoff(wedMorning, 0, ny)).toMatchObject({ deadline: new Date("2026-10-28T18:00:00Z"), today: true, msLeft: 4 * 3_600_000 });
    // One processing day: it leaves Thursday.
    expect(day(shipDay(wedMorning, 1, ny))).toBe("2026-10-29");
    expect(nextCutoff(wedMorning, 1, ny).today).toBe(false);

    // Wednesday 15:00: missed it, so Thursday.
    const wedAfternoon = new Date("2026-10-28T19:00:00Z");
    expect(day(shipDay(wedAfternoon, 0, ny))).toBe("2026-10-29");
    expect(nextCutoff(wedAfternoon, 0, ny)).toMatchObject({ deadline: new Date("2026-10-29T18:00:00Z"), today: false });

    // Friday 15:00: Monday, and the clocks went back on Sunday so 2 pm is 19:00 UTC.
    const friAfternoon = new Date("2026-10-30T19:00:00Z");
    expect(day(shipDay(friAfternoon, 0, ny))).toBe("2026-11-02");
    expect(nextCutoff(friAfternoon, 0, ny).deadline).toEqual(new Date("2026-11-02T19:00:00Z"));
    // A store that ships at weekends goes Saturday.
    expect(day(shipDay(friAfternoon, 0, { ...ny, weekends: true }))).toBe("2026-10-31");

    // Late evening in New York is already tomorrow in UTC; it's still Wednesday's order there.
    expect(day(shipDay(new Date("2026-10-29T02:00:00Z"), 0, ny))).toBe("2026-10-29");
    // London at noon.
    expect(nextCutoff(new Date("2026-10-28T09:00:00Z"), 0, { hour: 12, timeZone: "Europe/London", weekends: false }).deadline).toEqual(new Date("2026-10-28T12:00:00Z"));
  });

  it("moves product delivery dates and checks the settings", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    await setDeliveryEstimates(f.db, shopId, { enabled: true, processingDays: 0 });
    const mug = await createProduct(f.db, shopId, { title: "Mug", status: "active", variants: [{ title: "Default", priceMinor: 1500, stock: 9 }] });
    await f.db.update(schema.variants).set({ shipDaysMin: 2, shipDaysMax: 4 }).where(eq(schema.variants.productId, mug.id));
    const friAfternoon = new Date("2026-10-30T19:00:00Z");
    const before = (await productDelivery(f.db, await f.shop(), mug.id, { now: friAfternoon }))!;
    expect(before.cutoff).toBeNull();
    await setShipCutoff(f.db, shopId, ny);
    const after = (await productDelivery(f.db, await f.shop(), mug.id, { now: friAfternoon }))!;
    // Leaves Monday Nov 2, then 2 to 4 days in transit.
    expect([day(after.from), day(after.to)]).toEqual(["2026-11-04", "2026-11-06"]);
    // Monday's cutoff is more than a day away, so there's no countdown yet.
    expect(after.cutoff).toBeNull();
    // Thursday afternoon counts down to Friday's cutoff.
    const thu = (await productDelivery(f.db, await f.shop(), mug.id, { now: new Date("2026-10-29T19:00:00Z") }))!;
    expect(thu.cutoff).toMatchObject({ today: false, deadline: new Date("2026-10-30T18:00:00Z") });
    expect(day(thu.cutoff!.shipsOn)).toBe("2026-10-30");
    // The evening before the clocks go back, Sunday's cutoff is 25 hours away, and still counted down to.
    await setShipCutoff(f.db, shopId, { ...ny, weekends: true });
    const sat = (await productDelivery(f.db, await f.shop(), mug.id, { now: new Date("2026-10-31T18:30:00Z") }))!;
    expect(sat.cutoff).toMatchObject({ today: false, deadline: new Date("2026-11-01T19:00:00Z") });
    expect(sat.cutoff!.msLeft).toBeGreaterThan(24 * 3_600_000);

    await expect(setShipCutoff(f.db, shopId, { ...ny, hour: 0 })).rejects.toThrow("Pick a cutoff time");
    await expect(setShipCutoff(f.db, shopId, { ...ny, timeZone: "Mars/Olympus" })).rejects.toThrow("Pick your time zone");
    expect(await setShipCutoff(f.db, shopId, null)).toBeNull();
  });
});
