import { describe, expect, it } from "vitest";
import { addShippingRate, createShippingZone, DemoModel, productShipping } from "../src";
import { makeFixture } from "../evals/fixture";

describe("shipping cost on the product page", () => {
  it("shows the cheapest rate that takes the item, and when shipping becomes free", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const uk = await createShippingZone(f.db, shop.id, { name: "UK", countries: ["GB"] });
    await addShippingRate(f.db, shop.id, uk.id, { name: "Royal Mail", priceMinor: 395, freeOverMinor: 5000, minDays: 2, maxDays: 4, maxWeightGrams: 2000 });
    await addShippingRate(f.db, shop.id, uk.id, { name: "Courier", priceMinor: 895, freeOverMinor: 10000, minDays: 1, maxDays: 2 });

    expect(await productShipping(f.db, shop, { priceMinor: 1800, weightGrams: 300 }, "GB")).toEqual({ country: "GB", priceMinor: 395, freeOverMinor: 5000 });
    // Too heavy for Royal Mail: only the courier takes it.
    expect(await productShipping(f.db, shop, { priceMinor: 1800, weightGrams: 5000 }, "GB")).toEqual({ country: "GB", priceMinor: 895, freeOverMinor: 10000 });
    // Dear enough on its own to ship free.
    expect(await productShipping(f.db, shop, { priceMinor: 6000, weightGrams: 300 }, "GB")).toEqual({ country: "GB", priceMinor: 0, freeOverMinor: null });
    // Somewhere the store doesn't ship, and gift cards, show nothing.
    expect(await productShipping(f.db, shop, { priceMinor: 1800, weightGrams: 300 }, "JP")).toBeNull();
    expect(await productShipping(f.db, shop, { priceMinor: 1800, weightGrams: null, giftCard: true }, "GB")).toBeNull();
  });
});
