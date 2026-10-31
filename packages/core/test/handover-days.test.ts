import { describe, expect, it } from "vitest";
import {
  createProduct,
  DemoModel,
  formatHandoverDay,
  handoverDates,
  HANDOVER_DAYS_AHEAD,
  PICKUP_RATE_ID,
  setHandoverDays,
  setLocalPickup,
  startCheckout,
} from "../src";
import { makeFixture } from "../evals/fixture";

const austin = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("pickup and delivery days", () => {
  it("lists the open weekdays from the notice the store needs, in the store's time zone", () => {
    // Friday 2026-10-30, 23:30 in New York is already Saturday in UTC.
    const now = new Date("2026-10-31T03:30:00Z");
    const days = { weekdays: [1, 3, 5], leadDays: 1, timeZone: "America/New_York" };
    const dates = handoverDates(days, now);
    expect(dates.slice(0, 3)).toEqual(["2026-11-02", "2026-11-04", "2026-11-06"]);
    expect(dates.every((d) => [1, 3, 5].includes(new Date(`${d}T12:00:00Z`).getUTCDay()))).toBe(true);
    expect(dates.length).toBe(6);
    // Same-day pickup counts today; nothing goes past the window.
    expect(handoverDates({ ...days, weekdays: [5], leadDays: 0 }, now)[0]).toBe("2026-10-30");
    const last = handoverDates({ weekdays: [0, 1, 2, 3, 4, 5, 6], leadDays: 2, timeZone: "UTC" }, now);
    expect(last).toHaveLength(HANDOVER_DAYS_AHEAD);
    expect(last[0]).toBe("2026-11-02");
    expect(formatHandoverDay("2026-11-04")).toBe("Wednesday, November 4");
    expect(formatHandoverDay("2026-11-04", "fr-FR")).toBe("mercredi 4 novembre");
  });

  it("checks the days a store saves", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    await expect(setHandoverDays(f.db, shopId, { weekdays: [], leadDays: 1, timeZone: "America/Chicago" })).rejects.toThrow("Tick at least one day.");
    await expect(setHandoverDays(f.db, shopId, { weekdays: [1], leadDays: 9, timeZone: "America/Chicago" })).rejects.toThrow("Pick 0 to 7 days' notice.");
    await expect(setHandoverDays(f.db, shopId, { weekdays: [1], leadDays: 1, timeZone: "Mars/Olympus" })).rejects.toThrow("Pick your time zone.");
    expect(await setHandoverDays(f.db, shopId, { weekdays: [5, 1, 1, 9], leadDays: 1, timeZone: "America/Chicago" })).toEqual({ weekdays: [1, 5], leadDays: 1, timeZone: "America/Chicago" });
    expect((await f.shop()).handoverDays).toEqual({ weekdays: [1, 5], leadDays: 1, timeZone: "America/Chicago" });
    await setHandoverDays(f.db, shopId, null);
    expect((await f.shop()).handoverDays).toBeNull();
  });

  it("makes buyers pick a day for pickup and keeps it on the order", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const mug = await createProduct(f.db, shopId, { title: "Mug", status: "active", variants: [{ title: "Default", priceMinor: 1500, stock: 5 }] });
    const [variant] = await f.variants(mug.id);
    await setLocalPickup(f.db, shopId, { address: "Glow Lamps Studio\n12 Congress Ave, Austin" });
    await setHandoverDays(f.db, shopId, { weekdays: [0, 1, 2, 3, 4, 5, 6], leadDays: 1, timeZone: "America/Chicago" });
    const checkout = async (handoverOn: string | null, shippingRateId: string | null = PICKUP_RATE_ID) =>
      startCheckout(f.db, f.payments, await f.shop(), {
        email: "buyer@example.com",
        address: austin,
        lines: [{ variantId: variant!.id, quantity: 1 }],
        shippingRateId,
        handoverOn,
        storefront: true,
      });
    await expect(checkout(null)).rejects.toThrow("Pick the day you'll collect your order.");
    await expect(checkout("2020-01-01")).rejects.toThrow("Pick the day you'll collect your order.");
    const day = handoverDates((await f.shop()).handoverDays!)[2]!;
    const { order } = await checkout(day);
    expect(order).toMatchObject({ pickup: true, handoverOn: day });
    // Shipped orders don't need a day, and drop one sent anyway.
    const shipped = await checkout(day, null);
    expect(shipped.order).toMatchObject({ pickup: false, handoverOn: null });
  });
});
