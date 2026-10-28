import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createDiscount, DemoModel, exportStore, handlePaymentEvent, importStore, quoteCart, refundOrder, signUp, createShop, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  const [lamp] = await f.variants(f.products.lamp.id);
  const lines = [{ variantId: lamp!.id, quantity: 1 }];
  const checkout = (email: string, code?: string) => startCheckout(f.db, f.payments, shop, { email, address, lines, discountCode: code });
  const pay = async (order: { id: string; paymentIntentId: string | null; totalMinor: number }) => {
    const { body, signature } = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
  };
  return { ...f, shop, lines, checkout, pay };
}

describe("codes for first orders only", () => {
  it("works on a buyer's first order and not after, whatever happened to the earlier order", async () => {
    const f = await setup();
    await createDiscount(f.db, f.shop.id, { code: "HELLO15", kind: "percent", value: 15, firstOrderOnly: true });
    // The cart doesn't know who the buyer is yet, so it shows the code.
    expect((await quoteCart(f.db, f.shop, f.lines, { discountCode: "hello15" })).discount?.code).toBe("HELLO15");

    // An unpaid checkout doesn't count as an order.
    await f.checkout("ada@example.com");
    const { order } = await f.checkout("ada@example.com", "HELLO15");
    expect(order.discountCode).toBe("HELLO15");
    await f.pay(order);
    await expect(f.checkout("Ada@Example.com ", "HELLO15")).rejects.toThrow("HELLO15 is for a first order only.");

    // A buyer whose only order was refunded still had one.
    const { order: grace } = await f.checkout("grace@example.com");
    await f.pay(grace);
    await refundOrder(f.ctx, f.shop.id, grace.id, {});
    await expect(f.checkout("grace@example.com", "HELLO15")).rejects.toThrow("for a first order only");
    // Someone new can use it.
    await expect(f.checkout("linus@example.com", "HELLO15")).resolves.toBeTruthy();
  });

  it("can't be automatic, and store files carry it", async () => {
    const f = await setup();
    await expect(createDiscount(f.db, f.shop.id, { code: "AUTO", kind: "percent", value: 10, automatic: true, minSubtotalMinor: 5000, firstOrderOnly: true })).rejects.toThrow(
      "Give it a code to keep it for first orders.",
    );
    await createDiscount(f.db, f.shop.id, { code: "HELLO15", kind: "percent", value: 15, firstOrderOnly: true });
    const file = JSON.parse(JSON.stringify(await exportStore(f.db, f.shop.id)));
    expect(file.discount_codes.find((d: { code: string }) => d.code === "HELLO15")).toMatchObject({ first_order_only: true });
    const owner = await signUp(f.db, { email: "new-owner@example.com", password: "correct horse battery" });
    const fresh = await createShop(f.db, owner.id, { name: "Fresh Shop", country: "US" });
    await importStore(f.db, fresh.id, file);
    const copied = await f.db.query.discounts.findFirst({ where: eq(schema.discounts.shopId, fresh.id) });
    expect(copied).toMatchObject({ code: "HELLO15", firstOrderOnly: true });
  });
});
