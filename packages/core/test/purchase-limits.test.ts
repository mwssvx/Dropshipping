import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, describePurchaseLimit, exportStore, handlePaymentEvent, importStore, quoteCart, setPurchaseLimit, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Grace Hopper", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("purchase limits", () => {
  it("checks the limits", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const id = f.products.lamp.id;
    const none = { min: null, max: null, perCustomer: null };
    await expect(setPurchaseLimit(f.db, shopId, id, { ...none, max: 0 })).rejects.toThrow("whole numbers");
    await expect(setPurchaseLimit(f.db, shopId, id, { ...none, max: 100 })).rejects.toThrow("whole numbers");
    await expect(setPurchaseLimit(f.db, shopId, id, { ...none, min: 5, max: 3 })).rejects.toThrow("can't be more than the most per order");
    await expect(setPurchaseLimit(f.db, shopId, id, { ...none, max: 5, perCustomer: 3 })).rejects.toThrow("can't be more than the most per customer");
    expect(await setPurchaseLimit(f.db, shopId, id, { min: 2, max: 4, perCustomer: 10 })).toEqual({ min: 2, max: 4, perCustomer: 10 });
    expect(describePurchaseLimit({ min: 2, max: 4, perCustomer: 10 })).toBe("2 to 4 per order, 10 per customer");
    expect(describePurchaseLimit({ min: null, max: null, perCustomer: 1 })).toBe("1 per customer");
    // A minimum of 1 is no limit at all.
    expect(await setPurchaseLimit(f.db, shopId, id, { ...none, min: 1 })).toBeNull();
    expect(await setPurchaseLimit(f.db, shopId, id, none)).toBeNull();
  });

  it("flags too few or too many in the cart, counting every option together, and stops checkout", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const [small, large] = await f.variants(f.products.lamp.id);
    await setPurchaseLimit(f.db, shop.id, f.products.lamp.id, { min: 2, max: 3, perCustomer: null });

    let quote = await quoteCart(f.db, shop, [{ variantId: small!.id, quantity: 1 }]);
    expect(quote.items[0]!.limit).toMatchObject({ kind: "min", limit: 2 });
    await expect(startCheckout(f.db, f.payments, shop, { email: "grace@example.com", address, lines: [{ variantId: small!.id, quantity: 1 }] })).rejects.toThrow(
      "sold in sets of at least 2",
    );

    // 2 small + 2 large is 4 of the same lamp: one too many, shown once.
    quote = await quoteCart(f.db, shop, [{ variantId: small!.id, quantity: 2 }, { variantId: large!.id, quantity: 2 }]);
    expect(quote.items.map((i) => i.limit?.kind ?? null)).toEqual(["max", null]);
    expect(quote.items[0]!.purchaseLimit).toEqual({ min: 2, max: 3, perCustomer: null });

    quote = await quoteCart(f.db, shop, [{ variantId: small!.id, quantity: 1 }, { variantId: large!.id, quantity: 2 }]);
    expect(quote.items.every((i) => !i.limit)).toBe(true);
    const { order } = await startCheckout(f.db, f.payments, shop, { email: "grace@example.com", address, lines: [{ variantId: small!.id, quantity: 2 }] });
    expect(order.id).toBeTruthy();
  });

  it("counts what the buyer bought before for the per-customer limit", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const [small] = await f.variants(f.products.lamp.id);
    await setPurchaseLimit(f.db, shop.id, f.products.lamp.id, { min: null, max: null, perCustomer: 2 });
    const buy = async (email: string, quantity: number) => {
      const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email, address, lines: [{ variantId: small!.id, quantity }] });
      const { body, signature } = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
      await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
      return order;
    };

    await expect(buy("grace@example.com", 3)).rejects.toThrow("limited to 2 per customer, and you've already bought 0. You can add 2 more.");
    await buy("grace@example.com", 1);
    // An unpaid checkout doesn't count.
    await startCheckout(f.db, f.payments, shop, { email: "grace@example.com", address, lines: [{ variantId: small!.id, quantity: 1 }] });
    // The same buyer with different capitals is still the same buyer.
    await expect(buy("Grace@Example.com", 2)).rejects.toThrow("you've already bought 1. You can add 1 more.");
    await buy("grace@example.com", 1);
    await expect(buy("grace@example.com", 1)).rejects.toThrow("you've already bought 2.");
    // Someone else can still buy.
    await buy("alan@example.com", 2);

    // The signed-in buyer sees it in the cart already.
    const quote = await quoteCart(f.db, shop, [{ variantId: small!.id, quantity: 1 }], { buyerEmail: "grace@example.com" });
    expect(quote.items[0]!.limit).toMatchObject({ kind: "customer", limit: 2, bought: 2 });
    expect((await quoteCart(f.db, shop, [{ variantId: small!.id, quantity: 1 }])).items[0]!.limit).toBeNull();
  });

  it("comes along in a store export", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await setPurchaseLimit(f.db, shop.id, f.products.lamp.id, { min: 2, max: null, perCustomer: 6 });
    const data = await exportStore(f.db, shop.id);
    const lamp = data.products.find((p) => p.handle === f.products.lamp.handle)!;
    expect(lamp.purchase_limit).toEqual({ min: 2, max: null, per_customer: 6 });

    const g = await makeFixture(new DemoModel());
    const target = await g.shop();
    await g.db.delete(schema.products).where(eq(schema.products.shopId, target.id));
    await importStore(g.db, target.id, data);
    const copy = await g.db.query.products.findFirst({ where: eq(schema.products.handle, lamp.handle) });
    expect(copy!.purchaseLimit).toEqual({ min: 2, max: null, perCustomer: 6 });
  });
});
