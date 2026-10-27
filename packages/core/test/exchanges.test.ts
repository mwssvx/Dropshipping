import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { decideReturn, DemoModel, requestReturn, returnOptions, setReturnSettings } from "../src";
import { makeFixture } from "../evals/fixture";

describe("exchanges", () => {
  it("a buyer swaps for another option at the same price, and the merchant sends it free", async () => {
    const f = await makeFixture(new DemoModel());
    const rctx = { ...f.ctx, storeAddress: () => "https://glow.example" };
    const [bought] = await f.variants(f.products.lamp.id);
    const { id: _id, ...rest } = bought!;
    const [warm] = await f.db.insert(schema.variants).values({ ...rest, title: "Warm white", position: 1 }).returning();
    // Dearer or sold-out options aren't offered.
    await f.db.insert(schema.variants).values({ ...rest, title: "Deluxe", priceMinor: bought!.priceMinor + 1000, position: 2 });
    await f.db.insert(schema.variants).values({ ...rest, title: "Gone", stock: 0, position: 3 });
    const order = await f.shippedOrder();
    const [line] = await f.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
    const shop = await f.shop();

    const options = await returnOptions(f.db, shop, order);
    expect(options.exchanges[line!.id]).toEqual([{ variantId: warm!.id, title: `${f.products.lamp.title} – Warm white` }]);
    await expect(
      requestReturn(f.db, shop, order, { reason: "too_small_or_big", items: [{ lineId: line!.id, quantity: 1, exchangeVariantId: bought!.id }] }),
    ).rejects.toThrow("can't be swapped for right now");

    const request = await requestReturn(f.db, shop, order, { reason: "too_small_or_big", items: [{ lineId: line!.id, quantity: 1, exchangeVariantId: warm!.id }] });
    expect(request.items).toEqual([{ lineId: line!.id, quantity: 1, title: line!.title, exchangeVariantId: warm!.id, exchangeTitle: `${f.products.lamp.title} – Warm white` }]);

    await setReturnSettings(f.db, shop.id, { windowDays: 30, instructions: "Send it to 9 Dock Rd, Austin TX." });
    const done = await decideReturn(rctx, await f.shop(), request.id, { action: "exchange" });
    expect(done).toMatchObject({ status: "exchanged", merchantMessage: "Send it to 9 Dock Rd, Austin TX." });
    const swap = await f.db.query.orders.findFirst({ where: eq(schema.orders.id, done.replacementOrderId!) });
    expect(swap).toMatchObject({ source: "replacement", replacesOrderId: order.id, totalMinor: 0 });
    const [sent] = await f.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, swap!.id) });
    expect(sent).toMatchObject({ variantId: warm!.id, title: `${f.products.lamp.title} – Warm white`, quantity: 1, unitPriceMinor: 0 });
    const mail = f.mailer.sent.find((m) => m.subject === `Your return for order #${order.number}`)!;
    expect(mail.text).toContain(`in exchange, as order #${swap!.number}`);
    expect(mail.text).toContain("What to send back: Send it to 9 Dock Rd, Austin TX.");
    // Nothing was refunded.
    expect((await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!.refundedMinor).toBe(0);
  });

  it("an exchange needs the buyer to have asked for one", async () => {
    const f = await makeFixture(new DemoModel());
    const rctx = { ...f.ctx, storeAddress: () => "https://glow.example" };
    const order = await f.shippedOrder();
    const [line] = await f.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
    const shop = await f.shop();
    expect((await returnOptions(f.db, shop, order)).exchanges).toEqual({});
    const request = await requestReturn(f.db, shop, order, { reason: "damaged", items: [{ lineId: line!.id, quantity: 1 }] });
    await expect(decideReturn(rctx, shop, request.id, { action: "exchange" })).rejects.toThrow("didn't ask for an exchange");
  });
});
