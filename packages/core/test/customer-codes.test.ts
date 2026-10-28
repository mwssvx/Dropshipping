import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createDiscount, createShop, DemoModel, exportStore, importStore, quoteCart, signUp, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("codes for tagged customers", () => {
  it("work only for buyers whose customer record has the tag", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const [lampV] = await f.variants(f.products.lamp.id);
    const lines = [{ variantId: lampV!.id, quantity: 1 }];
    await expect(createDiscount(f.db, shop.id, { code: "AUTOVIP", kind: "percent", value: 10, automatic: true, minSubtotalMinor: 1000, customerTag: "vip" })).rejects.toThrow("limit it to tagged customers");
    await expect(createDiscount(f.db, shop.id, { code: "LONGTAG", kind: "percent", value: 10, customerTag: "x".repeat(31) })).rejects.toThrow("up to 30 characters");
    const vip = await createDiscount(f.db, shop.id, { code: "VIP15", kind: "percent", value: 15, customerTag: "  VIP  Club " });
    expect(vip.customerTag).toBe("vip club");
    expect((await createDiscount(f.db, shop.id, { code: "EVERYONE", kind: "percent", value: 5, customerTag: " " })).customerTag).toBeNull();

    // The cart doesn't know who's buying yet, so the code shows there.
    expect((await quoteCart(f.db, shop, lines, { discountCode: "VIP15", country: "US" })).discountMinor).toBe(Math.floor(lampV!.priceMinor * 0.15));

    // At checkout: a stranger, and a customer without the tag, are turned away without naming it.
    const checkout = (email: string) => startCheckout(f.db, f.payments, shop, { email, address, lines, discountCode: "VIP15" });
    await expect(checkout("stranger@example.com")).rejects.toThrow("VIP15 is for some customers only");
    await f.db.insert(schema.customers).values({ shopId: shop.id, email: "bo@example.com", tags: ["wholesale"] });
    await expect(checkout("bo@example.com")).rejects.toThrow(/^((?!vip).)*$/);
    await expect(checkout("bo@example.com")).rejects.toThrow("some customers only");

    // A tagged customer gets it, whatever case they type their email in.
    await f.db.insert(schema.customers).values({ shopId: shop.id, email: "ada@example.com", tags: ["vip club", "newsletter"] });
    const { order } = await checkout("Ada@Example.com ");
    expect(order.discountCode).toBe("VIP15");
    // Taking the tag off ends it.
    await f.db.update(schema.customers).set({ tags: [] }).where(eq(schema.customers.email, "ada@example.com"));
    await expect(checkout("ada@example.com")).rejects.toThrow("some customers only");
  });

  it("keep their tag, products and automatic setting in a store file", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp } = f.products;
    await createDiscount(f.db, shop.id, { code: "VIPLAMP", kind: "percent", value: 15, customerTag: "vip", productIds: [lamp.id] });
    await createDiscount(f.db, shop.id, { code: "SPEND50", kind: "amount", value: 500, automatic: true, minSubtotalMinor: 5000 });
    const file = await exportStore(f.db, shop.id);
    expect(file.discount_codes.find((d) => d.code === "VIPLAMP")).toMatchObject({ customer_tag: "vip", products: [lamp.handle] });

    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, file);
    const codes = await f.db.query.discounts.findMany({ where: eq(schema.discounts.shopId, copy.id) });
    const viplamp = codes.find((d) => d.code === "VIPLAMP")!;
    expect(viplamp.customerTag).toBe("vip");
    expect(viplamp.productIds).toHaveLength(1);
    expect(viplamp.productIds[0]).not.toBe(lamp.id); // the copy's own lamp
    expect(codes.find((d) => d.code === "SPEND50")?.automatic).toBe(true);
  });
});
