import { describe, expect, it } from "vitest";
import { createDiscount, DemoModel, describeDiscount, quoteCart, spreadDiscountOver, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("codes for chosen products", () => {
  it("take money off only those products", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp, projector } = f.products;
    const [lampV] = await f.variants(lamp.id);
    const [projV] = await f.variants(projector.id);
    await expect(createDiscount(f.db, shop.id, { code: "SHIPLAMP", kind: "free_shipping", productIds: [lamp.id] })).rejects.toThrow("Free shipping is for the whole order");
    await expect(createDiscount(f.db, shop.id, { code: "AUTOLAMP", kind: "percent", value: 10, automatic: true, minSubtotalMinor: 1000, productIds: [lamp.id] })).rejects.toThrow("Give it a code");
    const pct = await createDiscount(f.db, shop.id, { code: "LAMP20", kind: "percent", value: 20, productIds: [lamp.id] });
    expect(describeDiscount(pct, "USD")).toBe("20% off selected products");
    const amt = await createDiscount(f.db, shop.id, { code: "LAMPOFF", kind: "amount", value: 1_000_000, productIds: [lamp.id] });
    expect(describeDiscount(amt, "USD")).toBe("$10,000.00 off selected products");

    const both = [{ variantId: lampV!.id, quantity: 2 }, { variantId: projV!.id, quantity: 1 }];
    const lampLine = 2 * lampV!.priceMinor;
    const q = await quoteCart(f.db, shop, both, { discountCode: "LAMP20", country: "US" });
    expect(q.discountMinor).toBe(Math.floor(lampLine * 0.2));
    // An amount never takes off more than the chosen products cost.
    expect((await quoteCart(f.db, shop, both, { discountCode: "LAMPOFF", country: "US" })).discountMinor).toBe(lampLine);
    // A cart without them can't use the code.
    await expect(quoteCart(f.db, shop, [{ variantId: projV!.id, quantity: 1 }], { discountCode: "LAMP20", country: "US" })).rejects.toThrow("none of them are in your cart");

    const { order } = await startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address, lines: both, discountCode: "LAMP20" });
    expect(order.discountMinor).toBe(Math.floor(lampLine * 0.2));
    expect(order.discountCode).toBe("LAMP20");
  });

  it("are spread over the chosen lines only, for tax", () => {
    expect(spreadDiscountOver([1000, 3000], [true, false], 200)).toEqual([800, 3000]);
    const odd = spreadDiscountOver([1000, 1000, 2000], [true, true, false], 301);
    expect(odd[0]! + odd[1]!).toBe(1699);
    expect(odd[2]).toBe(2000);
    // Everything eligible is the same as before.
    expect(spreadDiscountOver([1000, 3000], [true, true], 400)).toEqual([900, 2700]);
  });
});
