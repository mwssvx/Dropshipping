import { describe, expect, it } from "vitest";
import { bxgyDiscount, bxgyMissing, createDiscount, DemoModel, describeDiscount, productOffers, quoteCart, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const offer = { value: 100, buyQty: 2, getQty: 1, productIds: [] as string[] };
const unit = (productId: string, unitMinor: number, quantity = 1) => ({ productId, unitMinor, quantity });

describe("buy X get Y", () => {
  it("takes the cheapest items off, once per full group", () => {
    expect(bxgyDiscount(offer, [unit("a", 3000), unit("b", 2000), unit("c", 1000)])).toBe(1000);
    expect(bxgyDiscount(offer, [unit("a", 3000, 2)])).toBe(0);
    // Six items make two groups: the two cheapest are free.
    expect(bxgyDiscount(offer, [unit("a", 3000, 4), unit("b", 500, 2)])).toBe(1000);
    expect(bxgyDiscount({ ...offer, value: 50 }, [unit("a", 3001, 3)])).toBe(1500);
    // Only the products it's for count.
    expect(bxgyDiscount({ ...offer, productIds: ["a"] }, [unit("a", 3000, 2), unit("b", 100)])).toBe(0);
    expect(describeDiscount({ kind: "bxgy", value: 100, minSubtotalMinor: 0, buyQty: 2, getQty: 1, productIds: ["a"] }, "USD")).toBe("Buy 2, get 1 free on selected products");
    // One step away: with 2 in the cart, the next one is free.
    expect(bxgyMissing(offer, [unit("a", 3000, 2)])).toBe(1);
    expect(bxgyMissing(offer, [unit("a", 3000, 1)])).toBe(0);
    expect(bxgyMissing(offer, [unit("a", 3000, 3)])).toBe(0);
  });

  it("applies an automatic offer in the cart and at checkout, and checks codes", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const [lamp] = await f.variants(f.products.lamp.id);
    await expect(createDiscount(f.db, shop.id, { code: "AUTO10", kind: "percent", value: 10, automatic: true })).rejects.toThrow("Only buy X get Y");
    await expect(createDiscount(f.db, shop.id, { code: "B0G1", kind: "bxgy", value: 100, buyQty: 0, getQty: 1 })).rejects.toThrow("how many they buy");
    await createDiscount(f.db, shop.id, { code: "BUY2GET1", kind: "bxgy", value: 100, buyQty: 2, getQty: 1, automatic: true });

    const two = await quoteCart(f.db, shop, [{ variantId: lamp!.id, quantity: 2 }]);
    expect(two.discount).toBeNull();
    expect(two.offerNudge).toEqual({ label: "Buy 2, get 1 free", missing: 1, free: true });

    const three = await quoteCart(f.db, shop, [{ variantId: lamp!.id, quantity: 3 }]);
    expect(three.discount).toMatchObject({ code: "BUY2GET1", automatic: true, discountMinor: lamp!.priceMinor, label: "Buy 2, get 1 free" });
    expect(three.offerNudge).toBeNull();
    expect(await productOffers(f.db, shop, f.products.lamp.id)).toEqual(["Buy 2, get 1 free"]);

    const { order } = await startCheckout(f.db, f.payments, shop, {
      email: "ada@example.com",
      address: { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" },
      lines: [{ variantId: lamp!.id, quantity: 3 }],
    });
    expect(order).toMatchObject({ discountCode: "BUY2GET1", discountMinor: lamp!.priceMinor });

    // A typed code that the cart doesn't qualify for says what it needs.
    await createDiscount(f.db, shop.id, { code: "PROJECTOR3", kind: "bxgy", value: 50, buyQty: 1, getQty: 1, productIds: [f.products.projector.id] });
    await expect(quoteCart(f.db, shop, [{ variantId: lamp!.id, quantity: 2 }], { discountCode: "projector3" })).rejects.toThrow('"Buy 1, get 1 50% off on selected products". Add more');
    expect(await productOffers(f.db, shop, f.products.projector.id)).toEqual(["Buy 2, get 1 free"]);
  });
});
