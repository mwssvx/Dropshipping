import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, sendReorderReminders, setReorderDays, syncTracking, unsubscribeBuyer } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

async function delivered(f: Awaited<ReturnType<typeof makeFixture>>) {
  const o = await f.order(f.products.lamp.id);
  f.advance(7 * DAY);
  await syncTracking(f.ctx, { orderId: o.id });
  return (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, o.id) }))!;
}

describe("reorder reminders", () => {
  it("emails once, the product's days after the order arrived, with a link back to it", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await setReorderDays(f.db, shop.id, f.products.lamp.id, 30);
    const order = await delivered(f);
    expect(order.fulfillmentStatus).toBe("delivered");
    const mails = () => f.mailer.sent.filter((m) => m.subject.startsWith("Running low"));

    f.advance(29 * DAY);
    expect(await sendReorderReminders(f.ctx)).toEqual({ sent: 0 });
    f.advance(DAY + 1);
    expect(await sendReorderReminders(f.ctx)).toEqual({ sent: 1 });
    expect(mails()[0]).toMatchObject({ to: order.email, subject: "Running low on Sunset Projection Lamp?" });
    expect(mails()[0]!.text).toContain(`/products/${f.products.lamp.handle}`);
    expect(mails()[0]!.text).toContain("Hi Ada,");
    expect(mails()[0]!.headers?.["List-Unsubscribe"]).toContain("/unsubscribe/");
    // Once per order.
    f.advance(DAY);
    expect(await sendReorderReminders(f.ctx)).toEqual({ sent: 0 });
  });

  it("skips gifts, unsubscribed buyers, buyers who already bought it again, old orders and products without days", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    // No days on the product: nothing is sent.
    await delivered(f);
    f.advance(40 * DAY);
    expect(await sendReorderReminders(f.ctx)).toEqual({ sent: 0 });

    await expect(setReorderDays(f.db, shop.id, f.products.lamp.id, 3)).rejects.toThrow("7 to 180 days");
    await setReorderDays(f.db, shop.id, f.products.lamp.id, 14);
    const gift = await delivered(f);
    await f.db.update(schema.orders).set({ gift: { from: "Bo", message: "Happy birthday", recipientEmail: null } }).where(eq(schema.orders.id, gift.id));
    const unsubscribed = await delivered(f);
    await unsubscribeBuyer(f.db, shop.id, unsubscribed.email!);
    const first = await delivered(f);
    const again = await f.order(f.products.lamp.id);
    await f.db.update(schema.orders).set({ email: first.email }).where(eq(schema.orders.id, again.id));
    f.advance(15 * DAY);
    // The gift and the unsubscribed buyer are due but skipped, and so is the buyer who came back for more.
    expect(await sendReorderReminders(f.ctx)).toEqual({ sent: 0 });
    // The buyer who came back was due, so it was looked at and left out.
    expect((await f.db.query.orders.findFirst({ where: eq(schema.orders.id, first.id) }))!.reorderRemindedAt).not.toBeNull();
    // The order delivered 40+ days before the product got its days is past the lookback.
    expect(f.mailer.sent.filter((m) => m.subject.startsWith("Running low"))).toEqual([]);
    await expect(setReorderDays(f.db, shop.id, f.products.lamp.id, null)).resolves.toEqual({ reorderDays: null });
  });
});
