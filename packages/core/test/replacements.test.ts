import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  analyticsReport, decideReturn, DemoModel, getOrder, listReturns, profitReport, replacementsOf, requestReturn, reviewableItems, returnOptions, sendReplacement,
} from "../src";
import { DAY, makeFixture } from "../evals/fixture";

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  const order = await f.shippedOrder();
  const [line] = await f.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
  return { ...f, shopRow: shop, order, line: line!, rctx: { ...f.ctx, storeAddress: () => "https://glow.example" } };
}

describe("replacements", () => {
  it("sends items again for free as a linked order that goes to the supplier", async () => {
    const f = await setup();
    const waiting = await f.waitingOrder();
    const [waitingLine] = await f.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, waiting.id) });
    await expect(sendReplacement(f.ctx, f.shopRow, waiting.id, { items: [{ lineId: waitingLine!.id, quantity: 1 }] })).rejects.toThrow(`Order #${waiting.number} hasn't shipped yet.`);
    await expect(sendReplacement(f.ctx, f.shopRow, f.order.id, { items: [{ lineId: f.line.id, quantity: 0 }] })).rejects.toThrow("Pick at least one item");
    await expect(sendReplacement(f.ctx, f.shopRow, f.order.id, { items: [{ lineId: f.line.id, quantity: 2 }] })).rejects.toThrow("The order had 1 of");
    await expect(sendReplacement(f.ctx, f.shopRow, f.order.id, { items: [{ lineId: waitingLine!.id, quantity: 1 }] })).rejects.toThrow("isn't in this order");

    const replacement = await sendReplacement(f.ctx, f.shopRow, f.order.id, { items: [{ lineId: f.line.id, quantity: 1 }], note: "Sorry it got lost." });
    expect(replacement).toMatchObject({
      source: "replacement",
      replacesOrderId: f.order.id,
      number: waiting.number + 1,
      totalMinor: 0,
      paymentStatus: "paid",
      fulfillmentStatus: "sent_to_supplier",
      email: f.order.email,
      shippingAddress: f.order.shippingAddress,
    });
    const full = await getOrder(f.db, f.shopRow.id, replacement.id);
    expect(full.lines).toEqual([expect.objectContaining({ title: f.line.title, quantity: 1, unitPriceMinor: 0, unitCostMinor: f.line.unitCostMinor })]);
    expect(full.fulfillments).toHaveLength(1);
    // No invoice for something that wasn't sold.
    expect(await f.db.query.invoices.findMany({ where: eq(schema.invoices.orderId, replacement.id) })).toEqual([]);
    const mail = f.mailer.sent.find((m) => m.subject === `A replacement for order #${f.order.number} is on its way`)!;
    expect(mail.text).toContain("at no charge");
    expect(mail.text).toContain("From Glow Lamps: Sorry it got lost.");
    expect(mail.text).toContain(`It's order #${replacement.number}.`);
    expect((await replacementsOf(f.db, f.order.id)).map((r) => r.id)).toEqual([replacement.id]);

    // It isn't a sale, so analytics leave it out; its cost still counts against profit.
    const report = await analyticsReport(f.db, f.shopRow.id, { from: new Date(0), to: new Date(Date.now() + 365 * DAY) });
    expect(report.orders).toBe(2);
    const profit = await profitReport(f.db, f.shopRow, 30, new Date(Date.now() + 2 * DAY));
    expect(profit.totals.costMinor).toBe(3 * (f.line.unitCostMinor ?? 0));
    // The buyer reviews the first order, not the replacement too.
    expect(await reviewableItems(f.db, f.shopRow.id, replacement.paymentIntentId!)).toEqual([]);
  });

  it("answers a return for a package that never arrived with a replacement", async () => {
    const f = await setup();
    const request = await requestReturn(f.db, f.shopRow, f.order, { reason: "never_arrived", note: "Tracking hasn't moved in a week.", items: [{ lineId: f.line.id, quantity: 1 }] });
    await decideReturn(f.rctx, f.shopRow, request.id, { action: "replace", message: "Sending a new one by express." });
    const [answered] = await listReturns(f.db, f.shopRow.id, "all");
    expect(answered).toMatchObject({ status: "replaced", replacementOrderId: expect.any(String) });
    const replacement = (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, answered!.replacementOrderId!) }))!;
    expect(replacement).toMatchObject({ source: "replacement", replacesOrderId: f.order.id, note: "Sending a new one by express." });
    const mail = f.mailer.sent.find((m) => m.subject === `Your return for order #${f.order.number}`)!;
    expect(mail.text).toContain(`sending you a replacement as order #${replacement.number}. There's nothing to send back.`);
    expect((await returnOptions(f.db, f.shopRow, f.order)).open).toBeNull();
    await expect(decideReturn(f.rctx, f.shopRow, request.id, { action: "replace" })).rejects.toThrow("already closed");
  });

  it("can't replace a refunded order", async () => {
    const f = await setup();
    await f.db.update(schema.orders).set({ paymentStatus: "refunded", refundedMinor: f.order.totalMinor }).where(eq(schema.orders.id, f.order.id));
    await expect(sendReplacement(f.ctx, f.shopRow, f.order.id, { items: [{ lineId: f.line.id, quantity: 1 }] })).rejects.toThrow("This order was refunded");
  });
});
