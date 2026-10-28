import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { countOrders, DemoModel, fulfillmentParam, orderPage, paymentParam, viewQuery } from "../src";
import { makeFixture } from "../evals/fixture";

describe("order list status filters", () => {
  it("take only real statuses from a link", () => {
    expect(fulfillmentParam("shipped")).toBe("shipped");
    expect(fulfillmentParam("lost")).toBeUndefined();
    expect(fulfillmentParam(null)).toBeUndefined();
    expect(paymentParam("refunded")).toBe("refunded");
    expect(paymentParam("free")).toBeUndefined();
    expect(viewQuery("orders", { payment: "refunded", status: "shipped", page: "2" })).toBe("status=shipped&payment=refunded");
  });

  it("narrow the order list by delivery and payment", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const a = await f.order(f.products.lamp.id);
    const b = await f.order(f.products.lamp.id);
    const c = await f.order(f.products.lamp.id);
    const set = (id: string, v: Partial<typeof schema.orders.$inferInsert>) => f.db.update(schema.orders).set(v).where(eq(schema.orders.id, id));
    await set(a.id, { fulfillmentStatus: "shipped" });
    await set(b.id, { fulfillmentStatus: "shipped", paymentStatus: "refunded" });
    await set(c.id, { fulfillmentStatus: "delivered" });
    const ids = async (filter: Parameters<typeof orderPage>[2]) => (await orderPage(f.db, shop.id, filter)).orders.map((o) => o.id).sort();
    expect(await ids({ fulfillmentStatus: "shipped" })).toEqual([a.id, b.id].sort());
    expect(await ids({ paymentStatus: "refunded" })).toEqual([b.id]);
    expect(await ids({ fulfillmentStatus: "shipped", paymentStatus: "paid" })).toEqual([a.id]);
    expect(await countOrders(f.db, shop.id, { fulfillmentStatus: "delivered" })).toBe(1);
  });
});
