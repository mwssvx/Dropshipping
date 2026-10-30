import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { decideReturn, DemoModel, findGiftOrder, giftReturnCode, handlePaymentEvent, onOrderPaid, packingSlips, requestReturn, returnOptions, startCheckout, syncTracking } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

async function setup() {
  const f = await makeFixture(new DemoModel());
  const rctx = { ...f.ctx, storeAddress: () => "https://glow.example" };
  const shipped = await f.shippedOrder();
  // A gift ordered before return codes existed.
  await f.db.update(schema.orders).set({ gift: { from: "Ada Lovelace", message: "Happy birthday!", recipientEmail: null } }).where(eq(schema.orders.id, shipped.id));
  const order = (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, shipped.id) }))!;
  const [line] = await f.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
  return { ...f, rctx, order, line: line! };
}

describe("gift returns", () => {
  it("lets the recipient send a gift back for store credit, without the buyer hearing", async () => {
    const f = await setup();
    const shop = await f.shop();
    // The packing slip prints a code, made once and kept.
    const slip = (await packingSlips(f.db, shop.id, { orderId: f.order.id })).slips[0]!;
    const code = slip.gift!.returnCode!;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    expect(await giftReturnCode(f.db, (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, f.order.id) }))!)).toBe(code);
    expect((await findGiftOrder(f.db, shop.id, code.toLowerCase().replace("-", " ")))?.id).toBe(f.order.id);
    expect(await findGiftOrder(f.db, shop.id, "AAAAA-AAAAA")).toBeNull();

    const before = f.mailer.sent.length;
    await expect(requestReturn(f.db, shop, f.order, { gift: { name: "Grace", email: "not an email" }, reason: "changed_mind", items: [{ lineId: f.line.id, quantity: 1 }] })).rejects.toThrow("Enter your email");
    const request = await requestReturn(f.db, shop, f.order, { gift: { name: "Grace Hopper", email: "Grace@Example.com" }, reason: "changed_mind", items: [{ lineId: f.line.id, quantity: 1 }] });
    expect(request.giftReturn).toEqual({ name: "Grace Hopper", email: "grace@example.com" });
    // The buyer's order page doesn't show it, and they can't start another while it's open.
    const buyer = await returnOptions(f.db, shop, f.order);
    expect(buyer).toMatchObject({ latest: null, open: null, canRequest: false, blocked: expect.stringContaining("already a return open") });
    expect((await returnOptions(f.db, shop, f.order, new Date(), "gift")).latest?.id).toBe(request.id);

    // Only store credit (or approve, or decline): a refund would show on the buyer's card.
    await expect(decideReturn(f.rctx, shop, request.id, { action: "refund", amountMinor: 500 })).rejects.toThrow("give them store credit");
    await expect(decideReturn(f.rctx, shop, request.id, { action: "replace" })).rejects.toThrow("give them store credit");
    await decideReturn(f.rctx, shop, request.id, { action: "credit", amountMinor: request.suggestedMinor });
    const sent = f.mailer.sent.slice(before);
    expect(sent.every((m) => m.to === "grace@example.com")).toBe(true);
    expect(sent.find((m) => m.subject === "The gift you're returning to Glow Lamps")!.text).toMatch(/^Hi Grace,[\s\S]*store credit/);
    expect(sent.some((m) => m.text.includes("/orders/"))).toBe(false);
    const card = await f.db.query.giftCards.findFirst({ where: eq(schema.giftCards.email, "grace@example.com") });
    expect(card?.balanceMinor).toBe(request.suggestedMinor);
    expect((await f.db.query.orders.findFirst({ where: eq(schema.orders.id, f.order.id) }))!.refundedMinor).toBe(0);
  });

  it("gives new gift orders a code at checkout, and puts it in the recipient's email", async () => {
    const f = await makeFixture(new DemoModel());
    const [small] = await f.variants(f.products.lamp.id);
    const address = { name: "Grace Hopper", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
    const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email: "ada@example.com", address, lines: [{ variantId: small!.id, quantity: 1 }], gift: { from: "Ada", recipientEmail: "grace@example.com" } });
    const { body, signature } = f.payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor });
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    await onOrderPaid(f.ctx, order.id);
    f.advance(DAY + 1);
    await syncTracking(f.ctx, { orderId: order.id });
    const toGrace = f.mailer.sent.find((m) => m.to === "grace@example.com")!;
    expect(toGrace.text).toContain(`Not quite right? You can return it for store credit at https://glow-lamps.example/gift-return with the code ${order.gift!.returnCode}. Ada won't be told.`);

    // A store that doesn't take returns prints no code.
    const shop = await f.shop();
    await f.db.update(schema.shops).set({ returnWindowDays: 0 }).where(eq(schema.shops.id, shop.id));
    await f.db.update(schema.orders).set({ gift: { from: "Ada", message: null, recipientEmail: null } }).where(eq(schema.orders.id, order.id));
    expect((await packingSlips(f.db, shop.id, { orderId: order.id })).slips[0]!.gift).toEqual({ from: "Ada", message: null, returnCode: null });
  });
});
