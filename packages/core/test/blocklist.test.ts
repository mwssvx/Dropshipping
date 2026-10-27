import { describe, expect, it } from "vitest";
import { addressKey, blockBuyer, blockOrderBuyer, DemoModel, isOrderBuyerBlocked, listBlockedBuyers, startCheckout, unblockBuyer } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St.", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("blocked buyers", () => {
  it("matches an address however it's typed", () => {
    expect(addressKey(address)).toBe("US|78701|1 main st");
    expect(addressKey({ ...address, line1: " 1  MAIN st ", postalCode: "78 701" })).toBe("US|78701|1 main st");
    expect(addressKey({ ...address, line1: "" })).toBeNull();
  });

  it("turns a blocked email or address away at checkout, before any payment", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const [v] = await f.variants(f.products.lamp.id);
    const lines = [{ variantId: v!.id, quantity: 1 }];
    const order = await f.order(f.products.lamp.id);
    expect(await isOrderBuyerBlocked(f.db, shop.id, order)).toBe(false);
    await blockOrderBuyer(f.db, shop.id, order.id, "Chargeback");
    expect(await isOrderBuyerBlocked(f.db, shop.id, order)).toBe(true);
    // The same email, or a new email at the same address.
    await expect(startCheckout(f.db, f.payments, shop, { email: order.email.toUpperCase(), address: { ...address, line1: "9 Elm St" }, lines, storefront: true })).rejects.toThrow("We can't take this order.");
    await expect(startCheckout(f.db, f.payments, shop, { email: "new-name@example.com", address: { ...order.shippingAddress, line1: "1 main st" }, lines, storefront: true })).rejects.toThrow("We can't take this order.");
    // Someone else is fine.
    await startCheckout(f.db, f.payments, shop, { email: "grace@example.com", address: { ...address, line1: "9 Elm St" }, lines, storefront: true });

    const list = await listBlockedBuyers(f.db, shop.id);
    expect(list.map((b) => [b.kind, b.note])).toEqual(expect.arrayContaining([["email", "Chargeback"], ["address", "Chargeback"]]));
    // Blocking again changes nothing.
    await blockOrderBuyer(f.db, shop.id, order.id);
    expect(await listBlockedBuyers(f.db, shop.id)).toHaveLength(2);
    for (const b of list) await unblockBuyer(f.db, shop.id, b.id);
    await startCheckout(f.db, f.payments, shop, { email: order.email, address: order.shippingAddress, lines, storefront: true });
  });

  it("blocks an email typed by hand", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await expect(blockBuyer(f.db, shop.id, { email: "not an email" })).rejects.toThrow("Enter an email address");
    const [row] = await blockBuyer(f.db, shop.id, { email: " Fraud@Example.com " });
    expect(row).toMatchObject({ kind: "email", value: "fraud@example.com" });
    const [v] = await f.variants(f.products.lamp.id);
    await expect(startCheckout(f.db, f.payments, shop, { email: "fraud@example.com", address, lines: [{ variantId: v!.id, quantity: 1 }] })).rejects.toThrow("We can't take this order.");
  });
});
