import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { BUSIEST_MIN_ORDERS, DemoModel, whenBuyersBuy } from "../src";
import { makeFixture } from "../evals/fixture";

const range = { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-11-01T00:00:00Z") };

describe("when buyers buy", () => {
  it("counts orders by weekday and time of day in the store's time zone", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    expect(await whenBuyersBuy(f.db, shop.id, range, "America/New_York")).toMatchObject({ timeZone: "America/New_York", orders: 0, busiest: null });

    const paidAt = async (iso: string) => {
      const o = await f.waitingOrder();
      await f.db.update(schema.orders).set({ paidAt: new Date(iso) }).where(eq(schema.orders.id, o.id));
      return o;
    };
    // Late Sunday evening in New York is early Monday in UTC.
    await paidAt("2026-10-26T00:30:00Z");
    await paidAt("2026-10-26T01:45:00Z");
    // Tuesday lunchtime.
    await paidAt("2026-10-27T16:00:00Z");
    // A refunded order still sold; one outside the range doesn't count.
    const refunded = await paidAt("2026-10-27T17:00:00Z");
    await f.db.update(schema.orders).set({ paymentStatus: "refunded" }).where(eq(schema.orders.id, refunded.id));
    await paidAt("2026-09-30T12:00:00Z");

    const ny = await whenBuyersBuy(f.db, shop.id, range, "America/New_York");
    expect(ny.orders).toBe(4);
    expect(ny.byDay.find((d) => d.day === "Sunday")!.orders).toBe(2);
    expect(ny.byDay.find((d) => d.day === "Tuesday")!.orders).toBe(2);
    expect(ny.byPart.find((p) => p.part === "6–9 pm")!.orders).toBe(1);
    expect(ny.byPart.find((p) => p.part === "9 pm–12 am")!.orders).toBe(1);
    expect(ny.byPart.find((p) => p.part === "12–3 pm")!.orders).toBe(2);
    // Too few orders to name the busiest time.
    expect(ny.busiest).toBeNull();

    const utc = await whenBuyersBuy(f.db, shop.id, range, "Not/AZone");
    expect(utc.timeZone).toBe("UTC");
    expect(utc.byDay.find((d) => d.day === "Monday")!.orders).toBe(2);

    for (let i = 0; i < BUSIEST_MIN_ORDERS - 4; i++) await paidAt(`2026-10-${10 + i}T23:00:00Z`);
    // Oct 10 to 15 at 7 pm in New York, Saturday to Thursday, and one more Sunday evening.
    await paidAt("2026-10-18T23:30:00Z");
    expect((await whenBuyersBuy(f.db, shop.id, range, "America/New_York")).busiest).toEqual({ day: "Sunday", part: "6–9 pm", orders: 3 });
  });
});
