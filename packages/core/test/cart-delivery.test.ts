import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { cartDelivery, createProduct, deliveryWindow, DemoModel, productDelivery, rateDeliveryWindows, setDeliveryEstimates, setHolidayDeadline } from "../src";
import { makeFixture } from "../evals/fixture";

const DAY = 86_400_000;

describe("delivery dates in the cart", () => {
  it("shows the slowest item's dates, counts pre-orders from their ship-by date, and skips what doesn't ship", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    await setDeliveryEstimates(f.db, shopId, { enabled: true, processingDays: 1 });
    const make = async (title: string, min: number, max: number) => {
      const p = await createProduct(f.db, shopId, { title, status: "active", variants: [{ title: "Default", priceMinor: 1500, stock: 9 }] });
      await f.db.update(schema.variants).set({ shipDaysMin: min, shipDaysMax: max }).where(eq(schema.variants.productId, p.id));
      const v = (await f.db.query.variants.findFirst({ where: eq(schema.variants.productId, p.id) }))!;
      return { product: p, variantId: v.id };
    };
    const mug = await make("Mug", 3, 5);
    const lamp = await make("Lamp", 6, 12);
    const now = new Date("2026-10-28T10:00:00Z");
    const shop = await f.shop();

    const cart = (await cartDelivery(f.db, shop, [{ variantId: mug.variantId }, { variantId: lamp.variantId }], { now }))!;
    const slowest = (await productDelivery(f.db, shop, lamp.product.id, { now }))!;
    expect([cart.from, cart.to]).toEqual([slowest.from, slowest.to]);
    expect(cart.country).toBe(slowest.country);
    expect(cart.holiday).toBeNull();

    // Gift cards and downloads alone ship nothing.
    expect(await cartDelivery(f.db, shop, [{ variantId: mug.variantId, giftCard: true }, { variantId: lamp.variantId, digital: true }], { now })).toBeNull();
    // A download next to the mug doesn't slow it down.
    const mugOnly = (await cartDelivery(f.db, shop, [{ variantId: mug.variantId }, { variantId: lamp.variantId, digital: true }], { now }))!;
    expect(mugOnly.to).toEqual((await productDelivery(f.db, shop, mug.product.id, { now }))!.to);

    // A pre-order waits for its ship-by date, then transit.
    const pre = (await cartDelivery(f.db, shop, [{ variantId: mug.variantId, preorderShipsBy: "2026-11-20" }], { now }))!;
    expect(pre.to.getTime() - new Date("2026-11-20T23:59:59.999Z").getTime()).toBe((mugOnly.to.getTime() - now.getTime()) - (shop.processingDays * DAY));
    expect(pre.holiday).toBeNull();

    await setHolidayDeadline(f.db, shopId, { name: "Christmas", arriveBy: "2026-12-24" }, now);
    const festive = (await cartDelivery(f.db, await f.shop(), [{ variantId: mug.variantId }, { variantId: lamp.variantId }], { now }))!;
    expect(festive.holiday).toMatchObject({ name: "Christmas", today: false });
    expect(festive.holiday!.orderBy).toEqual(new Date(Date.UTC(2026, 11, 24) - (festive.processingDays + festive.transitMax) * DAY));

    await setDeliveryEstimates(f.db, shopId, { enabled: false, processingDays: 1 });
    expect(await cartDelivery(f.db, await f.shop(), [{ variantId: mug.variantId }], { now })).toBeNull();
  });

  it("gives each checkout rate its own dates", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    await setDeliveryEstimates(f.db, shopId, { enabled: true, processingDays: 1 });
    const p = await createProduct(f.db, shopId, { title: "Mug", status: "active", variants: [{ title: "Default", priceMinor: 1500, stock: 9 }] });
    await f.db.update(schema.variants).set({ shipDaysMin: 3, shipDaysMax: 5 }).where(eq(schema.variants.productId, p.id));
    const v = (await f.db.query.variants.findFirst({ where: eq(schema.variants.productId, p.id) }))!;
    const now = new Date("2026-10-28T10:00:00Z");
    const shop = await f.shop();
    const rates = [
      { id: "standard", minDays: 2, maxDays: 4 },
      { id: "express", minDays: 1, maxDays: 2 },
      { id: "slow", minDays: 7, maxDays: 14 },
      { id: "plain", minDays: null, maxDays: null },
    ];
    const windows = await rateDeliveryWindows(f.db, shop, [{ variantId: v.id }], rates, now);
    // The supplier's own days set the floor; a slower rate pushes the dates out.
    expect(windows.get("express")).toEqual(deliveryWindow(now, 1, 3, 5, shop.shipCutoff));
    expect(windows.get("plain")).toEqual(deliveryWindow(now, 1, 3, 5, shop.shipCutoff));
    expect(windows.get("slow")).toEqual(deliveryWindow(now, 1, 7, 14, shop.shipCutoff));
    // A pre-order counts from its ship-by date.
    const pre = await rateDeliveryWindows(f.db, shop, [{ variantId: v.id, preorderShipsBy: "2026-11-20" }], rates, now);
    expect(pre.get("standard")!.from.getTime()).toBeGreaterThan(windows.get("standard")!.from.getTime());
    // Nothing when dates are off or nothing ships.
    expect((await rateDeliveryWindows(f.db, shop, [{ variantId: v.id, digital: true }], rates, now)).size).toBe(0);
    await setDeliveryEstimates(f.db, shopId, { enabled: false, processingDays: 1 });
    expect((await rateDeliveryWindows(f.db, await f.shop(), [{ variantId: v.id }], rates, now)).size).toBe(0);
  });
});
