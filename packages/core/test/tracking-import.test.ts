import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, importTracking, ordersCsv, readTrackingCsv, trackingTemplateCsv } from "../src";
import { makeFixture } from "../evals/fixture";

describe("tracking from a spreadsheet", () => {
  it("marks the orders in the file shipped, says which rows it couldn't use, and changes nothing the second time", async () => {
    const f = await makeFixture(new DemoModel());
    const waiting = await f.waitingOrder();
    const failed = await f.outOfStockOrder();
    const shipped = await f.shippedOrder();
    const refunded = await f.waitingOrder();
    await f.db.update(schema.orders).set({ paymentStatus: "refunded" }).where(eq(schema.orders.id, refunded.id));
    const held = await f.waitingOrder();
    await f.db.update(schema.orders).set({ heldAt: new Date() }).where(eq(schema.orders.id, held.id));
    const shippedTracking = (await f.db.query.fulfillments.findFirst({ where: eq(schema.fulfillments.orderId, shipped.id) }))!.trackingNumber;

    const template = await trackingTemplateCsv(f.db, (await f.shop()).id);
    const [head, ...rows] = template.trim().split("\n");
    expect(head).toBe("Order,Name,Country,Items,Carrier,Tracking number,Tracking link");
    expect(rows.map((r) => r.split(",")[0])).toEqual([String(waiting.number), String(failed.number)]);
    expect(rows[0]).toContain("1 × Sunset Projection Lamp");

    const file = [
      "Order,Carrier,Tracking number,Tracking link",
      `#${waiting.number},USPS,9400111899223100001234,https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223100001234`,
      `${waiting.number},USPS,9400111899223100001234,`,
      `${failed.number},Royal Mail,AB123456789GB,`,
      `${shipped.number},UPS,1Z999AA10123456784,`,
      `${refunded.number},UPS,1Z999AA10123456785,`,
      `${held.number},UPS,1Z999AA10123456786,`,
      `99999,UPS,1Z999AA10123456787,`,
      `abc,UPS,1Z999AA10123456788,`,
      `${waiting.number},DHL,12,`,
      `${failed.number},DHL,JD0000000001,http://dhl.example/track`,
      ",,,",
    ].join("\n");
    const result = await importTracking(f.ctx, (await f.shop()).id, file);
    expect(result.shipped).toEqual([waiting.number, failed.number]);
    expect(result.alreadyHere).toEqual([]);
    expect(result.skipped).toEqual([
      { line: 5, order: String(shipped.number), reason: "This order has already shipped with other tracking." },
      { line: 6, order: String(refunded.number), reason: "This order was refunded." },
      { line: 7, order: String(held.number), reason: "This order is on hold for the risk check. Send or refund it from its page first." },
      { line: 8, order: "99999", reason: "There's no order with this number." },
      { line: 9, order: "abc", reason: "That isn't an order number." },
      { line: 10, order: String(waiting.number), reason: "Enter the tracking number." },
      { line: 11, order: String(failed.number), reason: "Tracking link must start with https://" },
    ]);

    const parcel = async (orderId: string) => f.db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, orderId) });
    expect(await parcel(waiting.id)).toMatchObject([{ status: "shipped", carrier: "USPS", trackingNumber: "9400111899223100001234" }]);
    expect((await parcel(waiting.id))[0]!.supplierOrderRef).not.toBeNull();
    // The failed one is the merchant's own now, so it isn't synced with the supplier any more.
    expect(await parcel(failed.id)).toMatchObject([{ status: "shipped", carrier: "Royal Mail", supplierOrderRef: null, problemCode: null }]);
    const orderRow = async (id: string) => (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, id) }))!;
    expect((await orderRow(waiting.id)).fulfillmentStatus).toBe("shipped");
    expect((await orderRow(failed.id)).fulfillmentStatus).toBe("shipped");
    expect((await parcel(shipped.id))[0]!.trackingNumber).toBe(shippedTracking);
    const mails = f.mailer.sent.filter((m) => m.to === waiting.email && m.subject.includes("on its way"));
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain("USPS: 9400111899223100001234");

    // The same file again: nothing new, no second email.
    const again = await importTracking(f.ctx, (await f.shop()).id, file);
    expect(again.shipped).toEqual([]);
    expect(again.alreadyHere).toEqual([waiting.number, failed.number]);
    expect(f.mailer.sent.filter((m) => m.to === waiting.email && m.subject.includes("on its way"))).toHaveLength(1);
    expect((await trackingTemplateCsv(f.db, (await f.shop()).id)).trim().split("\n")).toHaveLength(1);
  });

  it("reads our own order download with a Carrier column added, and refuses files without the columns", async () => {
    const f = await makeFixture(new DemoModel());
    const o = await f.waitingOrder();
    const exported = (await ordersCsv(f.db, (await f.shop()).id)).trim().split("\n");
    expect(exported[0]).toContain(",Tracking,");
    const filled = [exported[0] + ",Carrier", ...exported.slice(1).map((r) => r.replace(/,,,,$/, ",LX123456789CN,,,") + ",China Post")];
    expect(readTrackingCsv(filled.join("\n"))[0]).toMatchObject({ number: o.number, carrier: "China Post", trackingNumber: "LX123456789CN" });
    expect((await importTracking(f.ctx, (await f.shop()).id, filled.join("\n"))).shipped).toEqual([o.number]);

    expect(() => readTrackingCsv("Order,Tracking number\n1001,123456")).toThrow("Order, Carrier and Tracking number columns");
    await expect(importTracking(f.ctx, (await f.shop()).id, "Order,Carrier,Tracking number\n")).rejects.toThrow("no orders");
  });
});
