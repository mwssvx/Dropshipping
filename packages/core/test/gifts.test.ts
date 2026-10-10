import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createGiftCardProduct, DemoModel, eraseCustomer, exportCustomerData, handlePaymentEvent, onOrderPaid, startCheckout, syncTracking } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

const address = { name: "Grace Hopper", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const [small] = await f.variants(f.products.lamp.id);
  const buy = async (gift: Parameters<typeof startCheckout>[3]["gift"], lines = [{ variantId: small!.id, quantity: 1 }]) => {
    const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email: "ada@example.com", address, lines, gift });
    const { body, signature } = f.payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor });
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    await onOrderPaid(f.ctx, order.id);
    return (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
  };
  return { ...f, buy };
}

describe("gift orders", () => {
  it("checks what the buyer enters", async () => {
    const f = await setup();
    const shop = await f.shop();
    const [small] = await f.variants(f.products.lamp.id);
    const start = (gift: Parameters<typeof startCheckout>[3]["gift"]) =>
      startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address, lines: [{ variantId: small!.id, quantity: 1 }], gift });
    await expect(start({ from: " " })).rejects.toThrow("Add who the gift is from");
    await expect(start({ from: "Ada", recipientEmail: "grace at navy" })).rejects.toThrow("recipient's email");
    await expect(start({ from: "Ada", message: "x".repeat(301) })).rejects.toThrow("under 300 characters");
    const { order } = await start({ from: "Ada Lovelace", message: "  ", recipientEmail: "" });
    expect(order.gift).toEqual({ from: "Ada Lovelace", message: null, recipientEmail: null });
    // A gift card on its own is emailed to the buyer, so it can't be a gift order.
    const card = await createGiftCardProduct(f.db, shop, [2500]);
    const [cardVariant] = await f.variants(card.id);
    const { order: cardOrder } = await startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address, lines: [{ variantId: cardVariant!.id, quantity: 1 }], gift: { from: "Ada" } });
    expect(cardOrder.gift).toBeNull();
  });

  it("tells the buyer it's a gift, and the recipient when it ships, without prices", async () => {
    const f = await setup();
    const before = f.mailer.sent.length;
    const order = await f.buy({ from: "Ada Lovelace", message: "Happy birthday! Light up your evenings.", recipientEmail: "Grace@Example.com" });
    expect(order.gift).toEqual({ from: "Ada Lovelace", message: "Happy birthday! Light up your evenings.", recipientEmail: "grace@example.com" });
    const confirmation = f.mailer.sent.slice(before).find((m) => m.subject === `Order #${order.number} confirmed`)!;
    expect(confirmation.to).toBe("ada@example.com");
    expect(confirmation.text).toMatch(/^Hi Ada,/);
    expect(confirmation.text).toContain("It's a gift for Grace Hopper. We'll email grace@example.com when it ships, with your message and tracking, but no prices.");
    expect(confirmation.text).toContain("Your message: Happy birthday! Light up your evenings.");
    // Nothing goes to the recipient before it ships.
    expect(f.mailer.sent.some((m) => m.to === "grace@example.com")).toBe(false);

    f.advance(DAY + 1);
    await syncTracking(f.ctx, { orderId: order.id });
    await syncTracking(f.ctx, { orderId: order.id });
    const toGrace = f.mailer.sent.filter((m) => m.to === "grace@example.com");
    expect(toGrace).toHaveLength(1);
    expect(toGrace[0]!.subject).toBe(`Ada Lovelace sent you a gift from Glow Lamps`);
    expect(toGrace[0]!.text).toContain("Hi Grace,");
    expect(toGrace[0]!.text).toContain("Their message:\nHappy birthday! Light up your evenings.");
    expect(toGrace[0]!.text).toMatch(/Track it:\n {2}\S+/);
    expect(toGrace[0]!.text).not.toMatch(/\$|USD|orders\//);
    const shipped = f.mailer.sent.find((m) => m.to === "ada@example.com" && m.subject === `Order #${order.number} is on its way`)!;
    expect(shipped.text).toMatch(/^Hi Ada,/);
  });

  it("sends nothing extra without a recipient email, and forgets the gift when the buyer is erased", async () => {
    const f = await setup();
    const order = await f.buy({ from: "Ada", message: "For you" });
    f.advance(DAY + 1);
    await syncTracking(f.ctx, { orderId: order.id });
    expect(await f.db.query.emails.findMany({ where: eq(schema.emails.kind, "gift_shipped") })).toEqual([]);

    const customer = (await f.db.query.customers.findFirst({ where: eq(schema.customers.email, "ada@example.com") }))!;
    const shop = await f.shop();
    expect((await exportCustomerData(f.db, shop, customer.id)).orders[0]!.gift).toEqual({ from: "Ada", message: "For you", recipientEmail: null });
    await f.db.update(schema.orders).set({ fulfillmentStatus: "delivered" }).where(eq(schema.orders.id, order.id));
    await eraseCustomer(f.db, shop.id, customer.id, { confirmEmail: "ada@example.com" });
    expect((await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!.gift).toBeNull();
  });
});
