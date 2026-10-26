import { describe, expect, it } from "vitest";
import { checkAddress, DemoModel, editOrder, exportStore, FakeSupplier, onOrderPaid, setCheckoutPhone, startCheckout, handlePaymentEvent } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("phone number at checkout", () => {
  it("tidies a phone number and turns away one that isn't", () => {
    expect(checkAddress({ ...address, phone: "  +1 (512)   555-0100 " }).address?.phone).toBe("+1 (512) 555-0100");
    expect(checkAddress({ ...address, phone: "call me" }).problem).toEqual({ field: "phone", message: "Check the phone number. Include the area code, like +1 512 555 0100." });
    expect(checkAddress({ ...address, phone: "123" }).problem?.field).toBe("phone");
    expect(checkAddress({ ...address, phone: "+1 512 555 0100 555 0100" }).problem?.field).toBe("phone");
  });

  it("follows the store's setting on the checkout page, and goes to the supplier", async () => {
    const f = await makeFixture(new DemoModel());
    const [v] = await f.variants(f.products.lamp.id);
    const lines = [{ variantId: v!.id, quantity: 1 }];
    const shop = await f.shop();
    expect(shop.checkoutPhone).toBe("optional");

    await setCheckoutPhone(f.db, shop.id, "required");
    await expect(startCheckout(f.db, f.payments, await f.shop(), { email: "ada@example.com", address, lines, storefront: true })).rejects.toThrow("Enter a phone number for the courier.");
    // A payment link the merchant builds doesn't need one.
    await startCheckout(f.db, f.payments, await f.shop(), { email: "ada@example.com", address, lines });

    const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email: "ada@example.com", address: { ...address, phone: "512 555 0100" }, lines, storefront: true });
    const { body, signature } = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    await onOrderPaid(f.ctx, order.id);
    const supplier = f.ctx.suppliers.get("fake") as FakeSupplier;
    expect(supplier.placed.at(-1)!.address.phone).toBe("512 555 0100");

    // Changing the address on a form without a phone keeps it; a new one replaces it.
    const fresh = await f.waitingOrder();
    await editOrder(f.ctx, shop.id, order.id, { address: { ...address, line1: "2 Main St" } }, "merchant");
    const kept = await f.db.query.orders.findFirst({ where: (o, { eq }) => eq(o.id, order.id) });
    expect(kept!.shippingAddress.phone).toBe("512 555 0100");
    expect(fresh.shippingAddress.phone).toBeUndefined();

    // Off: a number typed anyway isn't kept.
    await setCheckoutPhone(f.db, shop.id, "off");
    const { order: off } = await startCheckout(f.db, f.payments, await f.shop(), { email: "grace@example.com", address: { ...address, phone: "512 555 0100" }, lines, storefront: true });
    expect(off.shippingAddress.phone).toBeUndefined();
    expect((await exportStore(f.db, shop.id)).store.checkout_phone).toBe("off");
  });
});
