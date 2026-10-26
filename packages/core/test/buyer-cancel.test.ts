import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { buyerCancelOptions, cancelOrderByBuyer, DemoModel, getOrder, signUp } from "../src";
import { makeFixture } from "../evals/fixture";

const HOUR = 3_600_000;

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  const ctx = { ...f.ctx, payments: f.payments, adminUrl: (p: string) => `https://app.example${p}` };
  return { f, shop, ctx };
}

describe("buyers cancelling their own order", () => {
  it("stops the supplier order and refunds it all, and tells the people who handle orders", async () => {
    const { f, shop, ctx } = await setup();
    const staff = await signUp(f.db, { email: "staff@example.com", password: "correct horse" });
    await f.db.insert(schema.shopMembers).values({ shopId: shop.id, userId: staff.id, role: "staff" });
    const order = await f.waitingOrder();
    expect(await buyerCancelOptions(f.ctx, shop.id, order.id)).toMatchObject({ canCancel: true, until: new Date(order.paidAt!.getTime() + 12 * HOUR) });

    const result = await cancelOrderByBuyer(ctx, shop.id, order.id, { reason: "  Ordered the wrong colour " });
    expect(result).toMatchObject({ full: true });
    const after = await getOrder(f.db, shop.id, order.id);
    expect(after).toMatchObject({ paymentStatus: "refunded", refundedMinor: order.totalMinor });
    expect(after.fulfillments.map((x) => x.status)).toEqual(["cancelled"]);
    expect(after.edits.at(-1)).toMatchObject({ by: "buyer", changes: ["Cancelled: Ordered the wrong colour"] });
    const refund = await f.db.query.refunds.findFirst({ where: eq(schema.refunds.orderId, order.id) });
    expect(refund?.reason).toBe("Cancelled by the buyer: Ordered the wrong colour");
    // The buyer gets the refund email; the owner and staff (who handle orders) hear it was cancelled.
    const told = f.mailer.sent.filter((m) => m.subject === `Order #${order.number} at Glow Lamps was cancelled by the buyer`).map((m) => m.to);
    expect(told.sort()).toEqual(["owner@example.com", "staff@example.com"]);
    expect(f.mailer.sent.find((m) => m.to === "owner@example.com" && m.subject.includes("cancelled"))!.text).toContain(`https://app.example/admin/orders/${order.id}`);
    // Once is enough.
    await expect(cancelOrderByBuyer(ctx, shop.id, order.id)).rejects.toThrow("can't be cancelled online");
  });

  it("only in the first 12 hours, before it ships, when the store allows it", async () => {
    const { f, shop, ctx } = await setup();
    const fresh = await f.waitingOrder();
    await f.setShop({ buyerCancel: false });
    expect((await buyerCancelOptions(f.ctx, shop.id, fresh.id)).canCancel).toBe(false);
    await f.setShop({ buyerCancel: true });
    expect((await buyerCancelOptions(f.ctx, shop.id, fresh.id)).canCancel).toBe(true);

    // A supplier order caught mid-send can't be stopped: the order is left as it was.
    await f.db.update(schema.fulfillments).set({ status: "placing" }).where(eq(schema.fulfillments.orderId, fresh.id));
    await expect(cancelOrderByBuyer(ctx, shop.id, fresh.id)).rejects.toThrow("already being packed");
    const still = await getOrder(f.db, shop.id, fresh.id);
    expect(still).toMatchObject({ paymentStatus: "paid", refundedMinor: 0 });
    expect(still.edits).toEqual([]);

    // After 12 hours it's too late.
    f.advance(13 * HOUR);
    await f.db.update(schema.fulfillments).set({ status: "placed" }).where(eq(schema.fulfillments.orderId, fresh.id));
    expect((await buyerCancelOptions(f.ctx, shop.id, fresh.id)).canCancel).toBe(false);
    await expect(cancelOrderByBuyer(ctx, shop.id, fresh.id)).rejects.toThrow("can't be cancelled online");
  });

  it("says so when the refund doesn't go through, and asks the merchant to refund it", async () => {
    const { f, shop, ctx } = await setup();
    const order = await f.waitingOrder();
    const failing = { ...ctx, payments: Object.assign(Object.create(Object.getPrototypeOf(f.payments)), f.payments, { refund: async () => Promise.reject(new Error("card network down")) }) };
    await expect(cancelOrderByBuyer(failing, shop.id, order.id)).rejects.toThrow("the refund didn't go through right away");
    const after = await getOrder(f.db, shop.id, order.id);
    expect(after).toMatchObject({ paymentStatus: "paid", refundedMinor: 0 });
    expect(after.fulfillments.map((x) => x.status)).toEqual(["cancelled"]);
    const mail = f.mailer.sent.find((m) => m.subject === `Refund needed: order #${order.number} at Glow Lamps was cancelled`)!;
    expect(mail.text).toContain("card network down");
  });
});
