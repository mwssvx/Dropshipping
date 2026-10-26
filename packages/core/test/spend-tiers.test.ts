import { describe, expect, it } from "vitest";
import { createDiscount, DemoModel, productOffers, quoteCart, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("spend more, save more", () => {
  it("takes money off orders over each step without a code, and says how far the next step is", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const [lamp] = await f.variants(f.products.lamp.id);
    const price = lamp!.priceMinor;
    await expect(createDiscount(f.db, shop.id, { code: "FREESHIP", kind: "free_shipping", automatic: true, minSubtotalMinor: 100 })).rejects.toThrow("under Shipping");
    // Over two lamps: 10% off. Over three: 15% off. Over four: a fixed amount that's less than 15%.
    await createDiscount(f.db, shop.id, { code: "SPEND2", kind: "percent", value: 10, automatic: true, minSubtotalMinor: price * 2 });
    await createDiscount(f.db, shop.id, { code: "SPEND3", kind: "percent", value: 15, automatic: true, minSubtotalMinor: price * 3 });
    await createDiscount(f.db, shop.id, { code: "SPEND4", kind: "amount", value: 100, automatic: true, minSubtotalMinor: price * 4 });

    const one = await quoteCart(f.db, shop, [{ variantId: lamp!.id, quantity: 1 }]);
    expect(one.discount).toBeNull();
    expect(one.spendNudge).toEqual({ moreMinor: price, kind: "percent", value: 10 });

    const two = await quoteCart(f.db, shop, [{ variantId: lamp!.id, quantity: 2 }]);
    expect(two.discount).toMatchObject({ code: "SPEND2", automatic: true, discountMinor: Math.floor((price * 2) / 10) });
    expect(two.spendNudge).toEqual({ moreMinor: price, kind: "percent", value: 15 });

    // At the top step there's nothing better to aim for: the amount off saves less than 15%.
    const four = await quoteCart(f.db, shop, [{ variantId: lamp!.id, quantity: 4 }]);
    expect(four.discount).toMatchObject({ code: "SPEND3", discountMinor: Math.floor((price * 4 * 15) / 100) });
    expect(four.spendNudge).toBeNull();

    // A code the buyer types replaces the steps, and the cart doesn't nudge.
    await createDiscount(f.db, shop.id, { code: "FIVE", kind: "percent", value: 5 });
    const typed = await quoteCart(f.db, shop, [{ variantId: lamp!.id, quantity: 2 }], { discountCode: "FIVE" });
    expect(typed.discount).toMatchObject({ code: "FIVE" });
    expect(typed.spendNudge).toBeNull();

    // Product pages mention the steps; the order records the one used.
    expect(await productOffers(f.db, shop, f.products.lamp.id)).toEqual(expect.arrayContaining([expect.stringMatching(/^15% off orders over \$/)]));
    const { order } = await startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address, lines: [{ variantId: lamp!.id, quantity: 3 }] });
    expect(order).toMatchObject({ discountCode: "SPEND3", discountMinor: Math.floor((price * 3 * 15) / 100) });
  });
});
