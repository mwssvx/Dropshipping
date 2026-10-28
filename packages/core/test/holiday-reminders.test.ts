import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { cartDelivery, DemoModel, sendAbandonedCartEmails, setHolidayDeadline, startCheckout } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
const HOUR = 3_600_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

describe("holiday order-by date in cart reminders", () => {
  it("says the last day to order while there's still time, and nothing once it's too late", async () => {
    const f = await makeFixture(new DemoModel());
    const [lamp] = await f.variants(f.products.lamp.id);
    await f.db.update(schema.variants).set({ shipDaysMin: 3, shipDaysMax: 5 }).where(eq(schema.variants.id, lamp!.id));
    const ctx = { ...f.ctx, payUrl: (_: unknown, o: { id: string }) => `https://store.example/pay/${o.id}` };
    const remind = async (email: string) => {
      await startCheckout(f.db, f.payments, await f.shop(), { email, address, lines: [{ variantId: lamp!.id, quantity: 1 }] });
      await sendAbandonedCartEmails(ctx, new Date(Date.now() + 2 * HOUR));
      return f.mailer.sent.find((m) => m.to === email && m.subject.startsWith("You left something"))!.text;
    };

    expect(await remind("no-holiday@example.com")).not.toContain("in time for");

    await setHolidayDeadline(f.db, (await f.shop()).id, { name: "Christmas", arriveBy: inDays(40) });
    const holiday = (await cartDelivery(f.db, await f.shop(), [{ variantId: lamp!.id }], { country: "US" }))!.holiday!;
    const day = holiday.orderBy!.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    expect(await remind("in-time@example.com")).toContain(`\n\nOrder by ${day} to get it in time for Christmas.\n`);

    // Arriving tomorrow is out of reach, so the reminder doesn't mention it.
    await setHolidayDeadline(f.db, (await f.shop()).id, { name: "Christmas", arriveBy: inDays(1) });
    expect(await remind("too-late@example.com")).not.toContain("Christmas");
  });
});
