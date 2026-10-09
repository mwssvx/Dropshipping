import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { countOpenReturns, createShop, decideReturn, DemoModel, listReturns, requestReturn, returnOptions, setReturnSettings, signUp } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

async function setup() {
  const f = await makeFixture(new DemoModel());
  const rctx = { ...f.ctx, storeAddress: () => "https://glow.example" };
  const order = await f.shippedOrder();
  const [line] = await f.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
  return { ...f, rctx, order, line: line! };
}

describe("returns", () => {
  it("a buyer asks for a return, the merchant approves it and then refunds it", async () => {
    const f = await setup();
    const shop = await f.shop();
    const options = await returnOptions(f.db, shop, f.order);
    expect(options).toMatchObject({ canRequest: true, blocked: null, open: null });
    expect(options.lines.map((l) => l.id)).toEqual([f.line.id]);

    await expect(requestReturn(f.db, shop, f.order, { reason: "damaged", items: [{ lineId: f.line.id, quantity: 0 }] })).rejects.toThrow("at least one item");
    await expect(requestReturn(f.db, shop, f.order, { reason: "damaged", items: [{ lineId: f.line.id, quantity: 2 }] })).rejects.toThrow("You bought 1");
    const request = await requestReturn(f.db, shop, f.order, { reason: "damaged", note: "The glass is cracked.", items: [{ lineId: f.line.id, quantity: 1 }] });
    expect(request).toMatchObject({ status: "requested", suggestedMinor: f.order.subtotalMinor, items: [{ lineId: f.line.id, quantity: 1, title: f.line.title }] });
    await expect(requestReturn(f.db, shop, f.order, { reason: "other", items: [{ lineId: f.line.id, quantity: 1 }] })).rejects.toThrow("already asked");
    expect(await countOpenReturns(f.db, shop.id)).toBe(1);
    expect((await listReturns(f.db, shop.id))[0]).toMatchObject({ orderNumber: f.order.number, email: f.order.email });

    await setReturnSettings(f.db, shop.id, { windowDays: 30, instructions: "Send it to 9 Dock Rd, Austin TX. Keep the receipt." });
    await decideReturn(f.rctx, await f.shop(), request.id, { action: "approve" });
    expect(f.mailer.sent.at(-1)).toMatchObject({ to: f.order.email, subject: `Your return for order #${f.order.number}` });
    expect(f.mailer.sent.at(-1)!.text).toContain("What to do next: Send it to 9 Dock Rd");
    await expect(decideReturn(f.rctx, shop, request.id, { action: "approve" })).rejects.toThrow("already approved");
    await expect(decideReturn(f.rctx, shop, request.id, { action: "refund", amountMinor: f.order.totalMinor + 1 })).rejects.toThrow("at most");

    const done = await decideReturn(f.rctx, shop, request.id, { action: "refund", amountMinor: request.suggestedMinor });
    expect(done).toMatchObject({ status: "refunded", resolvedMinor: request.suggestedMinor });
    expect(done.refundId).toBeTruthy();
    expect((await f.db.query.orders.findFirst({ where: eq(schema.orders.id, f.order.id) }))!.refundedMinor).toBe(request.suggestedMinor);
    await expect(decideReturn(f.rctx, shop, request.id, { action: "decline", message: "No" })).rejects.toThrow("already closed");
    expect(await countOpenReturns(f.db, shop.id)).toBe(0);
  });

  it("store credit instead of a refund, and declining needs a reason", async () => {
    const f = await setup();
    const shop = await f.shop();
    const request = await requestReturn(f.db, shop, f.order, { reason: "changed_mind", items: [{ lineId: f.line.id, quantity: 1 }] });
    await expect(decideReturn(f.rctx, shop, request.id, { action: "decline", message: " " })).rejects.toThrow("Tell the buyer why");
    const done = await decideReturn(f.rctx, shop, request.id, { action: "credit", amountMinor: 2000 });
    expect(done).toMatchObject({ status: "credited", resolvedMinor: 2000 });
    const card = await f.db.query.giftCards.findFirst({ where: eq(schema.giftCards.id, done.giftCardId!) });
    expect(card).toMatchObject({ initialMinor: 2000, email: f.order.email });
    expect(f.mailer.sent.some((m) => m.subject === "Your $20.00 gift card for Glow Lamps")).toBe(true);
    // The order itself isn't refunded.
    expect((await f.db.query.orders.findFirst({ where: eq(schema.orders.id, f.order.id) }))!.refundedMinor).toBe(0);

    // A new request after one is closed is fine; this one is declined.
    const again = await requestReturn(f.db, shop, f.order, { reason: "other", items: [{ lineId: f.line.id, quantity: 1 }] });
    await decideReturn(f.rctx, shop, again.id, { action: "decline", message: "We already gave you store credit for this." });
    expect(f.mailer.sent.at(-1)!.text).toContain("can't accept this return");

    // Another store can't answer it.
    const user = await signUp(f.db, { email: "x@example.com", password: "correct horse" });
    const other = await createShop(f.db, user.id, { name: "Other", country: "US" });
    await expect(decideReturn(f.rctx, other, again.id, { action: "approve" })).rejects.toThrow("not found");
  });

  it("the return window closes after delivery, and can be turned off", async () => {
    const f = await setup();
    const shop = await f.shop();
    const later = new Date(Date.now() + 40 * DAY);
    const closed = await returnOptions(f.db, shop, f.order, later);
    expect(closed).toMatchObject({ canRequest: false, blocked: "Returns closed 30 days after delivery." });
    await expect(requestReturn(f.db, shop, f.order, { reason: "other", items: [{ lineId: f.line.id, quantity: 1 }] }, later)).rejects.toThrow("Returns closed");
    await expect(setReturnSettings(f.db, shop.id, { windowDays: 400, instructions: "" })).rejects.toThrow("0 to 365");
    await setReturnSettings(f.db, shop.id, { windowDays: 0, instructions: "" });
    expect((await returnOptions(f.db, await f.shop(), f.order)).blocked).toContain("handles returns by email");
  });
});
