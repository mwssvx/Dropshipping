import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  addWholesaleBuyer, applyForWholesale, createDiscount, createShop, decideWholesale, DemoModel, exportStore, importStore, listCustomers, listWholesaleBuyers,
  quoteCart, setQuantityBreaks, setWholesaleSettings, signUp, startCheckout, subscribeBuyer, wholesaleStatusFor,
} from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const [small, large] = await f.variants(f.products.lamp.id);
  const ctx = { db: f.db, mailer: f.mailer, storeAddress: () => "https://glow.example" };
  return { ...f, small: small!, large: large!, ctx };
}

describe("quantity discounts", () => {
  it("checks the tiers the merchant enters", async () => {
    const f = await setup();
    const shop = await f.shop();
    const set = (tiers: { minQty: number; percentOff: number }[]) => setQuantityBreaks(f.db, shop.id, f.products.lamp.id, tiers);
    await expect(set([{ minQty: 1, percentOff: 10 }])).rejects.toThrow("2 or more");
    await expect(set([{ minQty: 2, percentOff: 90 }])).rejects.toThrow("80%");
    await expect(set([{ minQty: 2, percentOff: 10 }, { minQty: 2, percentOff: 15 }])).rejects.toThrow("different quantity");
    await expect(set([{ minQty: 2, percentOff: 15 }, { minQty: 5, percentOff: 10 }])).rejects.toThrow("bigger discounts");
    await expect(set([2, 3, 4, 5].map((q) => ({ minQty: q, percentOff: q * 2 })))).rejects.toThrow("Up to 3");
    expect(await set([{ minQty: 5, percentOff: 15 }, { minQty: 2, percentOff: 10 }])).toEqual([{ minQty: 2, percentOff: 10 }, { minQty: 5, percentOff: 15 }]);
    await expect(setQuantityBreaks(f.db, "00000000-0000-0000-0000-000000000000", f.products.lamp.id, [])).rejects.toThrow("not found");
  });

  it("prices the cart by how many of a product are in it, across its variants", async () => {
    const f = await setup();
    const shop = await f.shop();
    await setQuantityBreaks(f.db, shop.id, f.products.lamp.id, [{ minQty: 2, percentOff: 10 }, { minQty: 5, percentOff: 15 }]);
    const one = await quoteCart(f.db, await f.shop(), [{ variantId: f.small.id, quantity: 1 }]);
    expect(one.items[0]).toMatchObject({ unitPriceMinor: f.small.priceMinor, priceNote: null });

    // One small and one large lamp make two lamps.
    const two = await quoteCart(f.db, await f.shop(), [{ variantId: f.small.id, quantity: 1 }, { variantId: f.large.id, quantity: 1 }]);
    expect(two.items.map((i) => i.unitPriceMinor)).toEqual([Math.round(f.small.priceMinor * 0.9), Math.round(f.large.priceMinor * 0.9)]);
    expect(two.items[0]).toMatchObject({ listUnitPriceMinor: f.small.priceMinor, priceNote: "Buy 2 or more, save 10%" });
    const five = await quoteCart(f.db, await f.shop(), [{ variantId: f.small.id, quantity: 5 }]);
    expect(five.items[0]!.unitPriceMinor).toBe(Math.round(f.small.priceMinor * 0.85));
    expect(five.subtotalMinor).toBe(five.items[0]!.unitPriceMinor * 5);

    // A discount code still works on top, and the order keeps the discounted unit price.
    await createDiscount(f.db, shop.id, { code: "EXTRA5", kind: "percent", value: 5 });
    const withCode = await quoteCart(f.db, await f.shop(), [{ variantId: f.small.id, quantity: 5 }], { discountCode: "EXTRA5" });
    expect(withCode.discountMinor).toBe(Math.round(withCode.subtotalMinor * 0.05));
    const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email: "ada@example.com", address, lines: [{ variantId: f.small.id, quantity: 5 }] });
    const lines = await f.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
    expect(lines[0]!.unitPriceMinor).toBe(Math.round(f.small.priceMinor * 0.85));
    expect(order.wholesale).toBe(false);
  });
});

describe("wholesale", () => {
  it("a buyer applies, the merchant approves, and they get wholesale prices with a minimum order", async () => {
    const f = await setup();
    const shop = await f.shop();
    await subscribeBuyer(f.db, shop.id, "shop@corner.example"); // has a customer record, like a signed-in buyer
    await expect(applyForWholesale(f.db, await f.shop(), "shop@corner.example", { company: "Corner Shop" })).rejects.toThrow("doesn't sell wholesale");
    await expect(setWholesaleSettings(f.db, shop.id, { enabled: true, percentOff: 0, minOrderMinor: 0 })).rejects.toThrow("at least 1%");
    await setWholesaleSettings(f.db, shop.id, { enabled: true, percentOff: 30, minOrderMinor: 10_000 });
    await expect(applyForWholesale(f.db, await f.shop(), "shop@corner.example", { company: " " })).rejects.toThrow("business name");
    await applyForWholesale(f.db, await f.shop(), "shop@corner.example", { company: "Corner Shop", taxId: "RS-123", message: "We run two shops." });
    expect(await wholesaleStatusFor(f.db, shop.id, "shop@corner.example")).toMatchObject({ wholesaleStatus: "pending", wholesaleCompany: "Corner Shop" });

    // Pending isn't approved: normal prices.
    await setQuantityBreaks(f.db, shop.id, f.products.lamp.id, [{ minQty: 2, percentOff: 10 }]);
    const cart = [{ variantId: f.small.id, quantity: 20 }];
    expect((await quoteCart(f.db, await f.shop(), cart, { buyerEmail: "shop@corner.example" })).wholesale).toBeNull();

    const [pending] = await listWholesaleBuyers(f.db, shop.id);
    expect(pending).toMatchObject({ wholesaleStatus: "pending", wholesaleTaxId: "RS-123", wholesaleMessage: "We run two shops." });
    await decideWholesale(f.ctx, await f.shop(), pending!.id, "approve");
    expect(f.mailer.sent.at(-1)).toMatchObject({ to: "shop@corner.example", subject: "You have wholesale prices at Glow Lamps" });
    expect(f.mailer.sent.at(-1)!.text).toContain("30% less on orders of $100.00 or more");

    // Wholesale replaces quantity discounts, and codes don't stack on it.
    const q = await quoteCart(f.db, await f.shop(), cart, { buyerEmail: "Shop@Corner.example" });
    expect(q.items[0]).toMatchObject({ unitPriceMinor: Math.round(f.small.priceMinor * 0.7), priceNote: "Wholesale price, 30% off" });
    expect(q.wholesale).toMatchObject({ percentOff: 30, minOrderMinor: 10_000 });
    await expect(quoteCart(f.db, await f.shop(), cart, { buyerEmail: "shop@corner.example", discountCode: "ANY" })).rejects.toThrow("don't apply to wholesale");
    // Only the signed-in account counts: the same cart without it is a normal one.
    expect((await quoteCart(f.db, await f.shop(), cart)).items[0]!.priceNote).toBe("Buy 2 or more, save 10%");

    // The minimum applies at checkout.
    const small = [{ variantId: f.small.id, quantity: 1 }];
    await expect(startCheckout(f.db, f.payments, await f.shop(), { email: "shop@corner.example", address, lines: small, buyerEmail: "shop@corner.example" })).rejects.toThrow("Wholesale orders start at $100.00");
    const big = [{ variantId: f.small.id, quantity: Math.ceil(10_000 / Math.round(f.small.priceMinor * 0.7)) }];
    const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email: "shop@corner.example", address, lines: big, buyerEmail: "shop@corner.example" });
    expect(order).toMatchObject({ wholesale: true });

    // Turning wholesale off stops the prices; removing a buyer does too.
    await setWholesaleSettings(f.db, shop.id, { enabled: false, percentOff: 30, minOrderMinor: 10_000 });
    expect((await quoteCart(f.db, await f.shop(), cart, { buyerEmail: "shop@corner.example" })).wholesale).toBeNull();
    await setWholesaleSettings(f.db, shop.id, { enabled: true, percentOff: 30, minOrderMinor: 0 });
    await decideWholesale(f.ctx, await f.shop(), pending!.id, "remove");
    expect((await quoteCart(f.db, await f.shop(), cart, { buyerEmail: "shop@corner.example" })).wholesale).toBeNull();
  });

  it("the merchant can add a buyer directly or decline an application, and settings survive export", async () => {
    const f = await setup();
    const shop = await f.shop();
    await setWholesaleSettings(f.db, shop.id, { enabled: true, percentOff: 25, minOrderMinor: 0 });
    await expect(addWholesaleBuyer(f.db, await f.shop(), { email: "nope", company: "" })).rejects.toThrow("email");
    await addWholesaleBuyer(f.db, await f.shop(), { email: "Buyer@Hotel.example", company: "Hotel Lumen" });
    expect((await quoteCart(f.db, await f.shop(), [{ variantId: f.small.id, quantity: 1 }], { buyerEmail: "buyer@hotel.example" })).wholesale).toMatchObject({ percentOff: 25 });
    expect((await listCustomers(f.db, shop.id)).some((c) => c.email === "buyer@hotel.example")).toBe(true);

    await subscribeBuyer(f.db, shop.id, "maybe@example.com");
    await applyForWholesale(f.db, await f.shop(), "maybe@example.com", { company: "Maybe Ltd" });
    const maybe = (await listWholesaleBuyers(f.db, shop.id)).find((b) => b.email === "maybe@example.com")!;
    await decideWholesale(f.ctx, await f.shop(), maybe.id, "decline");
    expect(f.mailer.sent.at(-1)!.subject).toBe("Your wholesale application to Glow Lamps");
    expect((await listWholesaleBuyers(f.db, shop.id)).map((b) => b.email)).toEqual(["buyer@hotel.example"]);
    // Another store can't decide on this store's buyers.
    const user = await signUp(f.db, { email: "other@example.com", password: "correct horse" });
    const other = await createShop(f.db, user.id, { name: "Other", country: "US" });
    await expect(decideWholesale(f.ctx, other, maybe.id, "approve")).rejects.toThrow("not found");

    await setQuantityBreaks(f.db, shop.id, f.products.lamp.id, [{ minQty: 3, percentOff: 12 }]);
    const file = await exportStore(f.db, shop.id);
    const fresh = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await importStore(f.db, fresh.id, JSON.parse(JSON.stringify(file)));
    const copied = await f.db.query.shops.findFirst({ where: eq(schema.shops.id, fresh.id) });
    expect(copied).toMatchObject({ wholesaleEnabled: true, wholesalePercentOff: 25 });
    expect((await f.db.query.products.findMany({ where: eq(schema.products.shopId, fresh.id) })).find((p) => p.quantityBreaks.length)!.quantityBreaks).toEqual([{ minQty: 3, percentOff: 12 }]);
  });
});
