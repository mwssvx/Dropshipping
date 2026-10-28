import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, exportStore, sendLateOrderEmails, setLateOrderNotice } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

describe("running late emails", () => {
  it("tells buyers once when their order hasn't shipped after the store's days", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const at = (ms: number) => ({ ...f.ctx, now: () => new Date(Date.now() + ms) });
    const late = (to: string) => f.mailer.sent.filter((m) => m.to === to && m.subject.includes("taking a little longer"));

    const waiting = await f.waitingOrder();
    expect(await sendLateOrderEmails(at(10 * DAY))).toEqual({ sent: 0 });

    await expect(setLateOrderNotice(f.db, shop.id, { days: 4 })).rejects.toThrow("Pick after how many days");
    await expect(setLateOrderNotice(f.db, shop.id, { days: 3, message: "x".repeat(501) })).rejects.toThrow("under 500 characters");
    expect(await setLateOrderNotice(f.db, shop.id, { days: 3, message: "  Our supplier is busy before the holidays.\r\n\r\n\r\nThanks!  " })).toEqual({
      days: 3,
      message: "Our supplier is busy before the holidays.\n\nThanks!",
    });

    // Left alone: an order on hold, a pre-order, local pickup, one already shipped, and one far past its day.
    const held = await f.waitingOrder();
    await f.db.update(schema.orders).set({ heldAt: new Date() }).where(eq(schema.orders.id, held.id));
    const preorder = await f.waitingOrder();
    await f.db.update(schema.orders).set({ preorderShipsBy: new Date(Date.now() + 30 * DAY) }).where(eq(schema.orders.id, preorder.id));
    const pickup = await f.waitingOrder();
    await f.db.update(schema.orders).set({ pickup: true }).where(eq(schema.orders.id, pickup.id));
    const shipped = await f.shippedOrder();
    const old = await f.waitingOrder();
    await f.db.update(schema.orders).set({ paidAt: new Date(Date.now() - 30 * DAY) }).where(eq(schema.orders.id, old.id));

    expect(await sendLateOrderEmails(at(2 * DAY))).toEqual({ sent: 0 });
    expect(await sendLateOrderEmails(at(3 * DAY + 3_600_000))).toEqual({ sent: 1 });
    const [mail] = late(waiting.email);
    expect(mail!.subject).toBe(`Your order #${waiting.number} from Glow Lamps is taking a little longer`);
    expect(mail!.text).toContain("Hi Ada,\n\nYour order");
    expect(mail!.text).toContain("\n\nOur supplier is busy before the holidays.\n\nThanks!\n\nYour order: https://");
    for (const o of [held, preorder, pickup, shipped, old]) expect(late(o.email)).toHaveLength(0);
    // Only once, and it's on the order's timeline.
    expect(await sendLateOrderEmails(at(5 * DAY))).toEqual({ sent: 0 });
    expect(await f.db.query.emails.findMany({ where: eq(schema.emails.orderId, waiting.id) })).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "order_late", status: "sent" })]));

    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shop.id)));
    expect(file.store.late_order_notice).toEqual({ days: 3, message: "Our supplier is busy before the holidays.\n\nThanks!" });

    // Off: nobody hears.
    expect(await setLateOrderNotice(f.db, shop.id, null)).toBeNull();
    await f.waitingOrder();
    expect(await sendLateOrderEmails(at(5 * DAY))).toEqual({ sent: 0 });
  });
});
