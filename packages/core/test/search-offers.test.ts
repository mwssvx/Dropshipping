import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createProduct, addShippingRate, createShippingZone, DemoModel, searchOfferExtras } from "../src";
import { makeFixture } from "../evals/fixture";

describe("shipping and returns for search engines", () => {
  it("gives each option its cheapest home rate, delivery time and the return window", async () => {
    const f = await makeFixture(new DemoModel());
    let shop = await f.shop();
    const mug = await createProduct(f.db, shop.id, { title: "Mug", status: "active", variants: [{ title: "Small", priceMinor: 1500, stock: 5 }, { title: "Big", priceMinor: 6000, stock: 5 }] });
    const variants = await f.variants(mug.id);
    await f.db.update(schema.variants).set({ shipDaysMin: 3, shipDaysMax: 6 }).where(eq(schema.variants.productId, mug.id));
    const home = await createShippingZone(f.db, shop.id, { name: "Home", countries: [shop.country] });
    await addShippingRate(f.db, shop.id, home.id, { name: "Standard", priceMinor: 499, freeOverMinor: 5000, minDays: 2, maxDays: 5 });
    await f.db.update(schema.shops).set({ processingDays: 1, returnWindowDays: 14 }).where(eq(schema.shops.id, shop.id));
    shop = await f.shop();

    const extras = await searchOfferExtras(f.db, shop, mug, await f.variants(mug.id));
    const small = extras.get(variants.find((v) => v.title === "Small")!.id)!;
    const big = extras.get(variants.find((v) => v.title === "Big")!.id)!;
    expect(small).toMatchObject({
      hasMerchantReturnPolicy: { merchantReturnDays: 14, applicableCountry: shop.country },
      shippingDetails: {
        shippingRate: { value: "4.99", currency: shop.currency },
        shippingDestination: { addressCountry: shop.country },
        deliveryTime: { handlingTime: { maxValue: 1 }, transitTime: { minValue: 3, maxValue: 6 } },
      },
    });
    expect(big).toMatchObject({ shippingDetails: { shippingRate: { value: "0.00" } } });

    // No returns, and nothing at all for downloads.
    await f.db.update(schema.shops).set({ returnWindowDays: 0 }).where(eq(schema.shops.id, shop.id));
    const none = await searchOfferExtras(f.db, await f.shop(), mug, await f.variants(mug.id));
    expect(none.get(variants[0]!.id)).toMatchObject({ hasMerchantReturnPolicy: { returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted" } });
    expect((await searchOfferExtras(f.db, shop, { ...mug, digital: true }, variants)).size).toBe(0);
  });
});
