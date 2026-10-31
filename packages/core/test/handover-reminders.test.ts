import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, sendHandoverReminders, sendLateOrderEmails, setHandoverDays, setLocalPickup } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

const chicago = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

describe("pickup and delivery reminders", () => {
  it("emails buyers the day before their pickup or delivery, once", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const now = new Date();
    const ctx = { ...f.ctx, now: () => now };
    const tomorrow = chicago(new Date(now.getTime() + DAY));
    const later = chicago(new Date(now.getTime() + 3 * DAY));
    const order = async (set: Partial<typeof schema.orders.$inferInsert>) => {
      const o = await f.waitingOrder();
      await f.db.update(schema.orders).set({ paidAt: new Date(now.getTime() - DAY), handoverOn: tomorrow, ...set }).where(eq(schema.orders.id, o.id));
      return (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, o.id) }))!;
    };
    await setLocalPickup(f.db, shop.id, { address: "Glow Lamps Studio\n12 Congress Ave, Austin", instructions: "Ring the bell." });
    const pickup = await order({ pickup: true });
    const delivery = await order({ localDelivery: true });
    // Left alone: picked just now, already handed over, not tomorrow, and with no day.
    await order({ pickup: true, paidAt: new Date(now.getTime() - 3_600_000) });
    await order({ pickup: true, fulfillmentStatus: "delivered" });
    await order({ pickup: true, handoverOn: later });
    await order({ pickup: true, handoverOn: null });

    // Nothing until the store lets buyers pick a day.
    expect(await sendHandoverReminders(ctx)).toEqual({ sent: 0 });
    await setHandoverDays(f.db, shop.id, { weekdays: [0, 1, 2, 3, 4, 5, 6], leadDays: 1, timeZone: "America/Chicago" });
    // It runs with the running-late emails.
    expect(await sendLateOrderEmails(ctx)).toEqual({ sent: 0, transit: 0, handover: 2 });
    expect(await sendHandoverReminders(ctx)).toEqual({ sent: 0 });

    const toPickup = f.mailer.sent.find((m) => m.subject === `See you tomorrow: order #${pickup.number} from ${shop.name}`)!;
    expect(toPickup.to).toBe(pickup.email);
    expect(toPickup.text).toContain(`you're collecting order #${pickup.number} tomorrow,`);
    expect(toPickup.text).toContain("12 Congress Ave, Austin");
    expect(toPickup.text).toContain("Ring the bell.");
    const toDelivery = f.mailer.sent.find((m) => m.subject === `Your order #${delivery.number} from ${shop.name} arrives tomorrow`)!;
    expect(toDelivery.text).toContain(delivery.shippingAddress.line1);
    const logged = await f.db.query.emails.findMany({ where: eq(schema.emails.kind, "handover_reminder") });
    expect(logged.map((e) => e.orderId).sort()).toEqual([pickup.id, delivery.id].sort());
  });
});
