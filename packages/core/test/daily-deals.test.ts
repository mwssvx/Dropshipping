import { describe, expect, it } from "vitest";
import { createShop, currentDailyDeal, dealTitle, DemoModel, exportStore, importStore, planDailyDeals, salesFor, signUp } from "../src";
import { makeFixture } from "../evals/fixture";

describe("deal of the day", () => {
  it("plans one product a day, midnight to midnight in the store's time zone", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = { id: (await f.shop()).id, country: "US", shipCutoff: { timeZone: "America/New_York" } };
    const { lamp, projector, stand } = f.products;
    // 10am in New York on Monday, Nov 25.
    const now = new Date("2030-11-25T15:00:00Z");

    const [first, second] = await planDailyDeals(f.db, shop, { productIds: [lamp.id, projector.id], percentOff: 30, startDate: "2030-11-25" }, now);
    // Today's deal starts now and ends at midnight; tomorrow's runs the whole day.
    expect(first).toMatchObject({ title: "Deal of the day: Sunset Projection Lamp", productIds: [lamp.id], percentOff: 30, countdown: true, dailyDeal: true });
    expect(first!.startsAt).toEqual(now);
    expect(first!.endsAt).toEqual(new Date("2030-11-26T05:00:00Z"));
    expect(second).toMatchObject({ title: "Deal of the day: Galaxy Projector", startsAt: new Date("2030-11-26T05:00:00Z"), endsAt: new Date("2030-11-27T05:00:00Z") });
    expect((await salesFor(f.db, shop.id, [lamp.id, projector.id], now)).get(lamp.id)?.percentOff).toBe(30);
    expect((await salesFor(f.db, shop.id, [lamp.id, projector.id], now)).has(projector.id)).toBe(false);

    const deal = await currentDailyDeal(f.db, shop.id, now);
    expect(deal.today?.product).toMatchObject({ title: "Sunset Projection Lamp", handle: lamp.handle });
    expect(deal.next?.product.title).toBe("Galaxy Projector");
    const tomorrow = await currentDailyDeal(f.db, shop.id, new Date("2030-11-26T06:00:00Z"));
    expect(tomorrow.today?.product.title).toBe("Galaxy Projector");
    expect(tomorrow.next).toBeNull();
    expect(await currentDailyDeal(f.db, shop.id, new Date("2030-11-27T05:00:00Z"))).toEqual({ today: null, next: null });

    // One deal a day: a second run can start once this one is over.
    await expect(planDailyDeals(f.db, shop, { productIds: [projector.id, lamp.id], percentOff: 20, startDate: "2030-11-26" }, now)).rejects.toThrow(
      "already have a deal of the day on Tue, Nov 26",
    );
    const after = await planDailyDeals(f.db, shop, { productIds: [projector.id, lamp.id], percentOff: 20, startDate: "2030-11-27" }, now);
    expect(after[0]!.startsAt).toEqual(new Date("2030-11-27T05:00:00Z"));

    await expect(planDailyDeals(f.db, shop, { productIds: [lamp.id], percentOff: 20, startDate: "2030-12-05" }, now)).rejects.toThrow("at least 2 days");
    await expect(planDailyDeals(f.db, shop, { productIds: [lamp.id, lamp.id], percentOff: 20, startDate: "2030-12-05" }, now)).rejects.toThrow("each product once");
    await expect(planDailyDeals(f.db, shop, { productIds: [lamp.id, stand.id], percentOff: 20, startDate: "2030-12-05" }, now)).rejects.toThrow("isn't on your store");
    await expect(planDailyDeals(f.db, shop, { productIds: [lamp.id, projector.id], percentOff: 20, startDate: "2030-11-24" }, now)).rejects.toThrow("Pick today");
    await expect(planDailyDeals(f.db, shop, { productIds: [lamp.id, projector.id], percentOff: 95, startDate: "2030-12-05" }, now)).rejects.toThrow("from 1% to 90%");

    // The deals travel in the store file, still deals of the day.
    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shop.id)));
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, file);
    expect((await currentDailyDeal(f.db, copy.id, new Date("2030-11-26T06:00:00Z"))).today?.product.title).toBe("Galaxy Projector");
  });

  it("follows the clocks changing", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = { id: (await f.shop()).id, country: "US", shipCutoff: { timeZone: "America/New_York" } };
    // New York goes back an hour on Sunday, Nov 1 2026: that day is 25 hours long.
    const [, sunday] = await planDailyDeals(f.db, shop, { productIds: [f.products.lamp.id, f.products.projector.id], percentOff: 15, startDate: "2026-10-31" }, new Date("2026-10-30T12:00:00Z"));
    expect(sunday!.startsAt).toEqual(new Date("2026-11-01T04:00:00Z"));
    expect(sunday!.endsAt).toEqual(new Date("2026-11-02T05:00:00Z"));
  });

  it("names a deal after its product, cut to fit", () => {
    expect(dealTitle("HOT SALE 2024 NEW Magnetic Phone Stand MPS-200 Free Shipping")).toBe("Deal of the day: HOT SALE 2024 NEW Magnetic Phone Stand MPS…");
    expect(dealTitle("HOT SALE 2024 NEW Magnetic Phone Stand MPS-200 Free Shipping")).toHaveLength(60);
  });
});
