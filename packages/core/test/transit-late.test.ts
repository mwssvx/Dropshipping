import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, exportStore, sendLateOrderEmails, setLateOrderNotice } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

describe("still on its way emails", () => {
  it("tells buyers once when a shipped parcel is past its delivery date", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const shipped = await f.shippedOrder();
    const [parcel] = await f.db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, shipped.id) });
    const shippedAt = parcel!.shippedAt!.getTime();
    const at = (ms: number) => ({ ...f.ctx, now: () => new Date(shippedAt + ms) });
    const mails = () => f.mailer.sent.filter((m) => m.to === shipped.email && m.subject.includes("still on its way"));

    // Off unless the store ticks it, even with running late emails on.
    await setLateOrderNotice(f.db, shop.id, { days: 7 });
    expect(await sendLateOrderEmails(at(12 * DAY))).toMatchObject({ transit: 0 });
    expect(await setLateOrderNotice(f.db, shop.id, { days: 7, message: "Thanks for waiting!", transit: true })).toEqual({ days: 7, message: "Thanks for waiting!", transit: true });

    // The demo supplier says 6 to 10 days in transit: nothing until a day after that.
    expect(await sendLateOrderEmails(at(10.5 * DAY))).toMatchObject({ transit: 0 });
    expect(await sendLateOrderEmails(at(11 * DAY + 3_600_000))).toMatchObject({ transit: 1 });
    const [mail] = mails();
    expect(mail!.subject).toBe(`Your order #${shipped.number} from Glow Lamps is still on its way`);
    expect(mail!.text).toContain("Hi Ada,\n\nYour order");
    if (parcel!.trackingUrl) expect(mail!.text).toContain(`Track it here: ${parcel!.trackingUrl}`);
    expect(mail!.text).toContain("\n\nThanks for waiting!\n\nYour order: https://");
    // Once, and on the order's timeline.
    expect(await sendLateOrderEmails(at(13 * DAY))).toMatchObject({ transit: 0 });
    expect(mails()).toHaveLength(1);
    expect(await f.db.query.emails.findMany({ where: eq(schema.emails.orderId, shipped.id) })).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "order_transit_late", status: "sent" })]));

    // A parcel already more than two weeks past its date when it's turned on is left alone.
    const old = await f.shippedOrder();
    expect(await sendLateOrderEmails(at(40 * DAY))).toMatchObject({ transit: 0 });
    expect(f.mailer.sent.filter((m) => m.to === old.email && m.subject.includes("still on its way") && m.subject.includes(`#${old.number}`))).toHaveLength(0);

    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shop.id)));
    expect(file.store.late_order_notice).toEqual({ days: 7, message: "Thanks for waiting!", transit: true });
  });
});
