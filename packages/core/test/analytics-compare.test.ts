import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { analyticsReport, comparisonRange, DemoModel, periodChange, periodTotals } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

describe("analytics compared with another period", () => {
  it("counts the earlier period the same way, and says how much things moved", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const now = new Date();
    const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY;
    const range = { from: new Date(tomorrow - 30 * DAY), to: new Date(tomorrow) };
    expect(comparisonRange(range, "previous")).toEqual({ from: new Date(tomorrow - 60 * DAY), to: range.from });
    const lastYear = comparisonRange(range, "year");
    expect(lastYear.from.getUTCFullYear()).toBe(range.from.getUTCFullYear() - 1);
    expect([lastYear.from.getUTCMonth(), lastYear.from.getUTCDate()]).toEqual([range.from.getUTCMonth(), range.from.getUTCDate()]);

    // One order this month, two in the month before, one about a year before this month.
    const paidAt = async (daysAgo: number) => {
      const o = await f.waitingOrder();
      await f.db.update(schema.orders).set({ paidAt: new Date(now.getTime() - daysAgo * DAY) }).where(eq(schema.orders.id, o.id));
      return o;
    };
    const recent = await paidAt(3);
    const [b1, b2] = [await paidAt(35), await paidAt(50)];
    const old = await paidAt(380);
    for (const [session, daysAgo] of [["visitor-0001", 2], ["visitor-0002", 4], ["visitor-0003", 40], ["visitor-0004", 385]] as const) {
      await f.db.insert(schema.storefrontEvents).values({ shopId: shop.id, sessionId: session, kind: "page_view", createdAt: new Date(now.getTime() - daysAgo * DAY) });
    }

    const current = await periodTotals(f.db, shop.id, range, now);
    const report = await analyticsReport(f.db, shop.id, range);
    expect(current).toEqual({ salesMinor: report.salesMinor, orders: report.orders, averageOrderMinor: report.averageOrderMinor, visitors: report.visitors, conversion: report.conversion });
    expect(current).toMatchObject({ salesMinor: recent.totalMinor, orders: 1, visitors: 2, conversion: 0.5 });
    expect(await periodTotals(f.db, shop.id, comparisonRange(range, "previous"), now)).toMatchObject({ salesMinor: b1.totalMinor + b2.totalMinor, orders: 2, visitors: 1, conversion: 1 });
    expect(await periodTotals(f.db, shop.id, lastYear, now)).toMatchObject({ salesMinor: old.totalMinor, orders: 1, visitors: 1 });

    // Visitor events are kept about 13 months, so a range starting before that has no visitor count.
    const ninety = { from: new Date(tomorrow - 90 * DAY), to: new Date(tomorrow) };
    expect(await periodTotals(f.db, shop.id, comparisonRange(ninety, "year"), now)).toMatchObject({ orders: 1, visitors: null, conversion: null });

    expect(periodChange(150, 100)).toBe(0.5);
    expect(periodChange(50, 100)).toBe(-0.5);
    expect(periodChange(5, 0)).toBeNull();
  });
});
