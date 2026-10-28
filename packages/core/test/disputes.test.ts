import { describe, expect, it } from "vitest";
import { schema } from "@sf/db";
import { eq } from "drizzle-orm";
import {
  acceptDispute,
  collectPushEvents,
  DemoModel,
  DISPUTE_FEE_MINOR,
  disputeEvidence,
  disputesForOrder,
  disputeStats,
  FakePaymentProvider,
  handlePaymentEvent,
  listDisputes,
  notifyNewDisputes,
  profitReport,
  submitDispute,
} from "../src";
import { DAY, makeFixture } from "../evals/fixture";

describe("disputes", () => {
  it("records a chargeback, gathers the evidence and sends it", async () => {
    const f = await makeFixture(new DemoModel());
    const fake = f.payments as FakePaymentProvider;
    const shop = await f.shop();
    const ctx = { db: f.db, payments: f.payments };
    const notify = { db: f.db, mailer: f.mailer, adminUrl: (path: string) => `https://app.example${path}` };
    const apply = async (e: { body: string; signature: string }) => handlePaymentEvent(f.db, "fake", (await fake.parseWebhook(e.body, e.signature))!);

    const order = await f.shippedOrder();
    const due = new Date(Date.now() + 7 * DAY);
    const event = fake.disputeEvent({ id: "dp_1", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor, reason: "product_not_received", evidenceDueBy: due });
    expect(await apply(event)).toMatchObject({ status: "processed", disputeShopId: shop.id });
    expect(await apply(event)).toMatchObject({ status: "duplicate" });
    expect(await apply(fake.disputeEvent({ paymentIntentId: "pi_nope", amountMinor: 100 }))).toMatchObject({ status: "unknown_order" });
    const [dispute] = await disputesForOrder(f.db, order.id);
    expect(dispute).toMatchObject({ status: "needs_response", reason: "product_not_received", amountMinor: order.totalMinor, inquiry: false });
    expect(dispute!.evidenceDueBy!.getTime()).toBe(due.getTime());

    // The owner hears once, by email and on their phone.
    expect(await notifyNewDisputes(notify)).toEqual({ sent: 1 });
    expect(await notifyNewDisputes(notify)).toEqual({ sent: 0 });
    const mail = f.mailer.sent.find((m) => m.to === "owner@example.com" && m.subject.startsWith(`Order #${order.number} was disputed: answer by`));
    expect(mail?.text).toContain("Reason: The buyer says it never arrived.");
    expect(mail?.text).toContain(`https://app.example/admin/orders/${order.id}#dispute`);
    expect((await collectPushEvents(f.db, shop.id, new Date(Date.now() - DAY))).find((e) => e.kind === "dispute")).toMatchObject({ title: `Order #${order.number} was disputed`, url: `/orders/${order.id}` });

    // Evidence from the order: tracking yes; no returns page until there is one.
    let gathered = await disputeEvidence(f.db, shop, dispute!.id);
    expect(gathered.checks.map((c) => [c.label, c.ok])).toEqual([
      ["Tracking number", true],
      ["Delivered", false],
      ["Returns policy", false],
      ["Emails to the buyer", true],
      ["Messages with the buyer", false],
    ]);
    // The order confirmation and the tracking email went to the buyer, and the bank sees when.
    expect(gathered.checks.find((c) => c.label === "Emails to the buyer")?.detail).toBe("Order confirmation, Shipping update.");
    expect(gathered.evidence.uncategorizedText).toMatch(/Emails the store sent the buyer about this order:\n.+: Order confirmation, ".+"\n.+: Shipping update, ".+"/);
    await f.returnsPage();
    gathered = await disputeEvidence(f.db, shop, dispute!.id);
    expect(gathered.checks.find((c) => c.label === "Returns policy")?.ok).toBe(true);
    const [shipment] = await f.db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, order.id) });
    expect(gathered.evidence).toMatchObject({
      customerName: "Ada Lovelace",
      customerEmail: order.email,
      shippingTrackingNumber: shipment!.trackingNumber,
      shippingDate: shipment!.shippedAt!.toISOString().slice(0, 10),
    });
    expect(gathered.evidence.refundPolicy).toContain("Returns: You can return anything within 30 days");
    expect(gathered.evidence.uncategorizedText).toContain(`Order #${order.number} from Glow Lamps`);
    expect(gathered.evidence.shippingAddress).toBe("Ada Lovelace, 1 Main St, Austin, TX 78701, US");

    await expect(submitDispute(ctx, shop, dispute!.id, { note: "x".repeat(2001) })).rejects.toThrow("under 2,000 characters");
    const sent = await submitDispute(ctx, shop, dispute!.id, { note: "The buyer emailed to say thanks on delivery day." });
    expect(sent).toMatchObject({ status: "under_review", note: "The buyer emailed to say thanks on delivery day." });
    expect(fake.disputeEvidence.get("dp_1")?.uncategorizedText).toContain("From the merchant: The buyer emailed to say thanks on delivery day.");
    await expect(submitDispute(ctx, shop, dispute!.id, {})).rejects.toThrow("isn't waiting for an answer");

    // The bank decides: won.
    await apply(fake.disputeEvent({ id: "dp_1", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor, status: "won", evidenceDueBy: due }));
    expect((await disputesForOrder(f.db, order.id))[0]!.status).toBe("won");

    // A second one: too late to answer, so the merchant accepts it, and profit counts it.
    const second = await f.waitingOrder();
    const before = (await profitReport(f.db, shop, 30)).totals;
    await apply(fake.disputeEvent({ id: "dp_2", paymentIntentId: second.paymentIntentId!, amountMinor: second.totalMinor, reason: "fraudulent", evidenceDueBy: new Date(Date.now() - DAY) }));
    const [late] = await disputesForOrder(f.db, second.id);
    await expect(submitDispute(ctx, shop, late!.id, {})).rejects.toThrow("deadline");
    expect(await acceptDispute(ctx, shop, late!.id)).toMatchObject({ status: "lost" });
    expect(fake.acceptedDisputes.has("dp_2")).toBe(true);
    const after = (await profitReport(f.db, shop, 30)).totals;
    expect(after.refundsMinor - before.refundsMinor).toBeGreaterThan(0);
    expect(after.feesMinor - before.feesMinor).toBe(DISPUTE_FEE_MINOR);

    // An inquiry asks first; it doesn't count toward the dispute rate.
    const third = await f.waitingOrder();
    await apply(fake.disputeEvent({ id: "dp_3", paymentIntentId: third.paymentIntentId!, amountMinor: third.totalMinor, inquiry: true, reason: "general" }));
    await notifyNewDisputes(notify);
    expect(f.mailer.sent.some((m) => m.subject === `Order #${third.number} has a question from the buyer's bank`)).toBe(true);

    expect((await listDisputes(f.db, shop.id)).map((d) => [d.orderNumber, d.status])).toEqual([
      [third.number, "needs_response"],
      [second.number, "lost"],
      [order.number, "won"],
    ]);
    const stats = await disputeStats(f.db, shop.id);
    expect(stats).toMatchObject({ open: 1, won: 1, lost: 1, recent: 2, orders: 3 });
    expect(stats.rate).toBeCloseTo(2 / 3);
    expect(stats.atStakeMinor).toBe(third.totalMinor);
  });
});
