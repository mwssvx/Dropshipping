import { describe, expect, it } from "vitest";
import {
  addShippingRate, createDiscount, createProduct, createShippingZone, createShop, signUp, DemoModel, exportStore, homeShipping, importStore, productShipping, quoteCart, setShippingSurcharge, startCheckout,
} from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("extra shipping for bulky products", () => {
  it("adds each one's extra to the shipping rate, even when the rate is free", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const us = await createShippingZone(f.db, shop.id, { name: "US", countries: ["US"] });
    const rate = await addShippingRate(f.db, shop.id, us.id, { name: "Standard", priceMinor: 500, freeOverMinor: 10000, minDays: 3, maxDays: 6 });
    const rug = await createProduct(f.db, shop.id, { title: "Wool Rug", status: "active", variants: [{ priceMinor: 6000, stock: 10 }] });
    const mug = await createProduct(f.db, shop.id, { title: "Mug", status: "active", variants: [{ priceMinor: 1500, stock: 10 }] });

    await expect(setShippingSurcharge(f.db, shop.id, rug.id, -1)).rejects.toThrow("from 0 to 1,000");
    await expect(setShippingSurcharge(f.db, shop.id, rug.id, 100_001)).rejects.toThrow("from 0 to 1,000");
    expect(await setShippingSurcharge(f.db, shop.id, rug.id, 2500)).toEqual({ shippingSurchargeMinor: 2500 });

    const [r] = await f.variants(rug.id);
    const [m] = await f.variants(mug.id);
    // Small things alone: the usual rate, and the nudge towards free shipping.
    const small = await quoteCart(f.db, shop, [{ variantId: m!.id, quantity: 1 }], { country: "US" });
    expect(small.shippingMinor).toBe(500);
    expect(small.surchargeMinor).toBe(0);
    expect(small.freeShipping?.overMinor).toBe(10000);

    // Two rugs and a mug: over the free amount, so the rate is free, but each rug still adds 25.
    const big = await quoteCart(f.db, shop, [{ variantId: r!.id, quantity: 2 }, { variantId: m!.id, quantity: 1 }], { country: "US" });
    expect(big.surchargeMinor).toBe(5000);
    expect(big.shippingMinor).toBe(5000);
    expect(big.totalMinor).toBe(12000 + 1500 + 5000);
    // Spending more wouldn't make it free, so the nudge doesn't show.
    expect(big.freeShipping).toBeNull();

    // One rug, under the free amount: rate plus extra.
    const one = await quoteCart(f.db, shop, [{ variantId: r!.id, quantity: 1 }], { country: "US", shippingRateId: rate.id });
    expect(one.shippingMinor).toBe(3000);

    // The order charges what the quote showed.
    const { order } = await startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address, lines: [{ variantId: r!.id, quantity: 1 }], storefront: true });
    expect(order.shippingMinor).toBe(3000);

    // A free-shipping code takes it all off.
    await createDiscount(f.db, shop.id, { code: "SHIPFREE", kind: "free_shipping", value: 0 });
    const coded = await quoteCart(f.db, shop, [{ variantId: r!.id, quantity: 1 }], { country: "US", discountCode: "SHIPFREE" });
    expect(coded.shippingMinor).toBe(0);

    // The product page and feeds show shipping with the extra, and no "free over" for the rug.
    expect(await productShipping(f.db, shop, { priceMinor: 6000, weightGrams: null, surchargeMinor: 2500 }, "US")).toEqual({ country: "US", priceMinor: 3000, freeOverMinor: null });
    const home = await homeShipping(f.db, shop, [{ id: r!.id, priceMinor: 12000, weightGrams: null, shipDaysMin: null, shipDaysMax: null, surchargeMinor: 2500 }]);
    expect(home.get(r!.id)?.priceMinor).toBe(2500);

    // It moves with the store.
    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shop.id)));
    expect(file.products.find((p: { handle: string }) => p.handle === rug.handle)?.shipping_surcharge_minor).toBe(2500);
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, file);
    const copied = await f.db.query.products.findFirst({ where: (p, { and, eq }) => and(eq(p.shopId, copy.id), eq(p.handle, rug.handle)) });
    expect(copied?.shippingSurchargeMinor).toBe(2500);
  });
});
