import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  assessOrderRisk,
  collectPushEvents,
  DemoModel,
  handlePaymentEvent,
  listOrders,
  onOrderPaid,
  refundOrder,
  releaseHeldOrder,
  routeStuckOrders,
  setRiskHold,
  shouldHold,
  startCheckout,
  todaySummary,
} from "../src";
import { makeFixture, type Fixture } from "../evals/fixture";

const address = (name: string, line1 = "1 Main St") => ({ name, line1, city: "Austin", region: "TX", postalCode: "78701", country: "US" });

async function checkout(f: Fixture, email: string, o: { name?: string; line1?: string; quantity?: number; pay?: "paid" | "failed" } = {}) {
  const [v] = await f.variants(f.products.lamp.id);
  const { order } = await startCheckout(f.db, f.payments, await f.shop(), {
    email,
    address: address(o.name ?? "Ada Lovelace", o.line1),
    lines: [{ variantId: v!.id, quantity: o.quantity ?? 1 }],
  });
  const ev =
    o.pay === "failed"
      ? f.payments.event({ id: `evt_f_${order.id}`, type: "payment.failed", paymentIntentId: order.paymentIntentId!, reason: "Card declined" })
      : f.payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor });
  await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(ev.body, ev.signature))!);
  if (o.pay !== "failed") await onOrderPaid(f.ctx, order.id);
  return (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
}

const fulfillments = (f: Fixture, orderId: string) => f.db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, orderId) });

describe("order risk check", () => {
  it("lets an ordinary order straight through to the supplier", async () => {
    const f = await makeFixture(new DemoModel());
    const order = await f.waitingOrder();
    expect(order.risk).toMatchObject({ level: "low", reasons: [] });
    expect(order.heldAt).toBeNull();
    expect(order.fulfillmentStatus).toBe("sent_to_supplier");
  });

  it("holds a high-risk order back from the supplier until the merchant sends it", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    // Two declined cards, then a throwaway inbox gets through.
    await checkout(f, "thief@mailinator.com", { pay: "failed" });
    await checkout(f, "thief@mailinator.com", { pay: "failed" });
    const order = await checkout(f, "thief@mailinator.com");
    expect(order.paymentStatus).toBe("paid");
    expect(order.risk!.level).toBe("high");
    expect(order.risk!.reasons).toEqual([
      "The email is from a throwaway inbox service (mailinator.com).",
      "2 payments with this email were declined in the last day.",
    ]);
    expect(order.heldAt).not.toBeNull();
    expect(await fulfillments(f, order.id)).toHaveLength(0);
    // The buyer still got their confirmation; nothing tells them it's held.
    expect(f.mailer.sent.some((m) => m.to === "thief@mailinator.com" && m.subject.includes("confirmed"))).toBe(true);

    // The safety-net job leaves it alone too.
    f.advance(10 * 60_000);
    expect((await routeStuckOrders(f.ctx)).routed).toBe(0);
    const summary = await todaySummary(f.db, shop);
    expect(summary.attention.find((a) => a.kind === "risk")).toMatchObject({ title: "1 order on hold", url: "/orders?show=held" });
    expect((await listOrders(f.db, shop.id, { held: true })).map((o) => o.id)).toEqual([order.id]);
    const push = (await collectPushEvents(f.db, shop.id, new Date(0))).find((e) => e.ref === order.id);
    expect(push).toMatchObject({ title: `New order #${order.number} is on hold`, body: expect.stringContaining("On hold: The email is from a throwaway inbox") });

    await releaseHeldOrder(f.ctx, shop.id, order.id);
    const sent = (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
    expect(sent.heldAt).toBeNull();
    expect(sent.riskReviewedAt).not.toBeNull();
    expect(sent.fulfillmentStatus).toBe("sent_to_supplier");
    await expect(releaseHeldOrder(f.ctx, shop.id, order.id)).rejects.toThrow("isn't on hold");
  });

  it("refunding a held order means nothing ever goes to the supplier", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await setRiskHold(f.db, shop.id, "medium");
    const order = await checkout(f, "someone@yopmail.com");
    expect(order.risk!.level).toBe("medium");
    expect(order.heldAt).not.toBeNull();
    await refundOrder(f.ctx, shop.id, order.id, { reason: "Looked like fraud" });
    f.advance(10 * 60_000);
    expect((await routeStuckOrders(f.ctx)).routed).toBe(0);
    expect(await fulfillments(f, order.id)).toHaveLength(0);
    expect(await listOrders(f.db, shop.id, { held: true })).toHaveLength(0);
    await expect(releaseHeldOrder(f.ctx, shop.id, order.id)).rejects.toThrow("refunded");
  });

  it("spots parcel forwarders, bursts of orders and bulk buys", async () => {
    const f = await makeFixture(new DemoModel());
    await checkout(f, "a@example.com", { name: "Ann One", line1: "9 Dock Rd" });
    await checkout(f, "b@example.com", { name: "Bob Two", line1: "9 dock rd." });
    const third = await checkout(f, "c@example.com", { name: "Cy Three", line1: "9 Dock Rd" });
    expect(third.risk!.reasons).toContain("3 different buyers shipped to this address in the last 30 days.");
    expect(third.risk!.level).toBe("medium");
    expect(third.heldAt).toBeNull(); // the default holds high risk only

    await checkout(f, "fast@example.com");
    await checkout(f, "fast@example.com");
    const burst = await checkout(f, "fast@example.com", { quantity: 12 });
    expect(burst.risk!.reasons).toEqual(expect.arrayContaining(["This email paid for 3 orders within an hour.", expect.stringMatching(/^Asks for 12 of /)]));
  });

  it("keeps its first verdict, and the setting decides what's held", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await setRiskHold(f.db, shop.id, "off");
    await checkout(f, "x@mailinator.com", { pay: "failed" });
    await checkout(f, "x@mailinator.com", { pay: "failed" });
    const order = await checkout(f, "x@mailinator.com");
    expect(order.risk!.level).toBe("high");
    expect(order.heldAt).toBeNull();
    expect(order.fulfillmentStatus).toBe("sent_to_supplier");
    const again = await assessOrderRisk(f.db, order.id);
    expect(again.level).toBe("high");
    await expect(setRiskHold(f.db, shop.id, "always")).rejects.toThrow("Pick when");
    expect(shouldHold("high", "medium")).toBe(false);
    expect(shouldHold("medium", "medium")).toBe(true);
    expect(shouldHold("medium", "low")).toBe(false);
  });
});
