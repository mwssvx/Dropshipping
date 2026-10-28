import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, draftPolicies, holidayReturnsNow, requestReturn, returnOptions, setHolidayReturns, setReturnSettings } from "../src";
import { makeFixture } from "../evals/fixture";

const holiday = { from: "2026-11-01", to: "2026-12-24", until: "2027-01-31" };
const asOf = new Date("2026-10-28T10:00:00Z");

describe("holiday returns", () => {
  it("keeps orders paid in the stretch returnable until the holiday date", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const order = await f.shippedOrder();
    const [line] = await f.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
    // Paid on Nov 20 and delivered on the 25th: 30 days takes it to Dec 25.
    await f.db.update(schema.orders).set({ paidAt: new Date("2026-11-20T15:00:00Z") }).where(eq(schema.orders.id, order.id));
    await f.db.update(schema.fulfillments).set({ shippedAt: new Date("2026-11-22T10:00:00Z"), deliveredAt: new Date("2026-11-25T10:00:00Z") }).where(eq(schema.fulfillments.orderId, order.id));
    const paid = (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
    const jan10 = new Date("2027-01-10T12:00:00Z");
    expect(await returnOptions(f.db, shop, paid, jan10)).toMatchObject({ canRequest: false, blocked: "Returns closed 30 days after delivery." });

    await expect(setHolidayReturns(f.db, shop, { ...holiday, from: "2026-11-31" }, asOf)).rejects.toThrow("Pick all three dates");
    await expect(setHolidayReturns(f.db, shop, { ...holiday, to: "2026-10-30" }, asOf)).rejects.toThrow("can't be before the first");
    await expect(setHolidayReturns(f.db, shop, { ...holiday, until: "2026-12-24" }, asOf)).rejects.toThrow("stay open after the last order day");
    await expect(setHolidayReturns(f.db, shop, { from: "2025-11-01", to: "2025-12-24", until: "2026-01-31" }, asOf)).rejects.toThrow("hasn't passed");
    await expect(setHolidayReturns(f.db, shop, { ...holiday, until: "2027-11-02" }, asOf)).rejects.toThrow("within a year");
    expect(await setHolidayReturns(f.db, shop, holiday, asOf)).toEqual(holiday);

    const withHoliday = await f.shop();
    const options = await returnOptions(f.db, withHoliday, paid, jan10);
    expect(options).toMatchObject({ canRequest: true, blocked: null });
    expect(options.closesAt).toEqual(new Date("2027-01-31T23:59:59.999Z"));
    expect(await requestReturn(f.db, withHoliday, paid, { reason: "changed_mind", items: [{ lineId: line!.id, quantity: 1 }] }, jan10)).toMatchObject({ status: "requested" });
    expect((await returnOptions(f.db, withHoliday, paid, new Date("2027-02-01T00:30:00Z"))).blocked).toBe("Returns for holiday orders closed on January 31.");

    // An order paid before the stretch keeps the usual window, and so does one whose window ends later anyway.
    const october = { ...paid, paidAt: new Date("2026-10-31T23:00:00Z") };
    expect((await returnOptions(f.db, withHoliday, october, jan10)).closesAt).toEqual(new Date("2026-12-25T10:00:00Z"));
    await setReturnSettings(f.db, shop.id, { windowDays: 90, instructions: "" });
    expect((await returnOptions(f.db, await f.shop(), paid, jan10)).closesAt).toEqual(new Date("2027-02-23T10:00:00Z"));

    // Product pages say so only while orders placed now get it.
    expect(holidayReturnsNow(withHoliday, asOf)).toBeNull();
    expect(holidayReturnsNow(withHoliday, new Date("2026-12-24T22:00:00Z"))).toEqual(new Date("2027-01-31"));
    expect(holidayReturnsNow(withHoliday, new Date("2026-12-25T00:30:00Z"))).toBeNull();

    // The returns policy says it until the date passes. With returns off, there's nothing to extend.
    const body = async () => (await draftPolicies(f.db, await f.shop())).find((d) => d.kind === "returns")!.body;
    expect(await body()).toContain("orders placed from November 1, 2026 to December 24, 2026 can be returned until January 31, 2027.");
    await setReturnSettings(f.db, shop.id, { windowDays: 0, instructions: "" });
    expect(await body()).not.toContain("January 31");
    expect(holidayReturnsNow(await f.shop(), new Date("2026-12-01T12:00:00Z"))).toBeNull();
    await expect(setHolidayReturns(f.db, await f.shop(), holiday, asOf)).rejects.toThrow("Set a return window first");
    expect(await setHolidayReturns(f.db, await f.shop(), null)).toBeNull();
  });
});
