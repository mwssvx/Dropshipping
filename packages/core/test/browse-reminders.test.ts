import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { browseReminderStats, DemoModel, handlePaymentEvent, recordProductView, sendBrowseReminders, setBrowseReminders, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const HOUR = 3_600_000;
const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("browse reminders", () => {
  it("emails a subscriber once about a product they looked at and didn't buy", async () => {
    const f = await makeFixture(new DemoModel());
    let shop = await f.shop();
    const ctx = { db: f.db, mailer: f.mailer, storeAddress: () => "https://glow.example" };
    const customer = async (email: string, acceptsMarketing = true) =>
      (await f.db.insert(schema.customers).values({ shopId: shop.id, email, name: `${email.split("@")[0]} Smith`, acceptsMarketing }).returning())[0]!;
    const ada = await customer("ada@example.com");
    const bob = await customer("bob@example.com", false);
    const cy = await customer("cy@example.com");
    const looked = new Date(Date.now() - 5 * HOUR);

    // Off by default: nothing is remembered.
    expect(await recordProductView(f.db, shop, ada, f.products.lamp.id, looked)).toBe(false);
    await setBrowseReminders(f.db, shop.id, true);
    shop = await f.shop();
    expect(await recordProductView(f.db, shop, ada, f.products.lamp.id, looked)).toBe(true);
    // Only buyers who said yes to emails, and only signed-in ones.
    expect(await recordProductView(f.db, shop, bob, f.products.lamp.id, looked)).toBe(false);
    expect(await recordProductView(f.db, shop, null, f.products.lamp.id, looked)).toBe(false);
    // Cy looked, then started a checkout: the checkout reminder has them.
    await recordProductView(f.db, shop, cy, f.products.lamp.id, looked);
    const [lamp] = await f.variants(f.products.lamp.id);
    await startCheckout(f.db, f.payments, shop, { email: "CY@example.com", address, lines: [{ variantId: lamp!.id, quantity: 1 }] });

    // Not before the wait.
    expect(await sendBrowseReminders(ctx, new Date(looked.getTime() + 3 * HOUR))).toEqual({ sent: 0 });
    const before = f.mailer.sent.length;
    expect(await sendBrowseReminders(ctx)).toEqual({ sent: 1 });
    const mail = f.mailer.sent.at(-1)!;
    expect(f.mailer.sent.length).toBe(before + 1);
    expect(mail.to).toBe("ada@example.com");
    expect(mail.subject).toBe("Still thinking about the Sunset Projection Lamp?");
    expect(mail.text).toContain("Hi ada,");
    expect(mail.text).toContain(`https://glow.example/products/${f.products.lamp.handle}?utm_source=browse-reminder`);
    expect(mail.text).toContain(`Unsubscribe: https://glow.example/unsubscribe/${ada.emailToken}`);
    // Once: another look the same week sends nothing more.
    await recordProductView(f.db, shop, ada, f.products.projector.id, new Date(Date.now() - 5 * HOUR));
    expect(await sendBrowseReminders(ctx)).toEqual({ sent: 0 });
    // A week on, a fresh look can get one, unless they've unsubscribed or the store turned it off.
    const weekOn = new Date(Date.now() + 8 * 24 * HOUR);
    await recordProductView(f.db, shop, ada, f.products.projector.id, new Date(weekOn.getTime() - 5 * HOUR));
    await f.db.update(schema.customers).set({ unsubscribedAt: new Date() }).where(eq(schema.customers.id, ada.id));
    expect(await sendBrowseReminders(ctx, weekOn)).toEqual({ sent: 0 });
    await f.db.update(schema.customers).set({ unsubscribedAt: null }).where(eq(schema.customers.id, ada.id));
    await setBrowseReminders(f.db, shop.id, false);
    expect(await sendBrowseReminders(ctx, weekOn)).toEqual({ sent: 0 });
    await setBrowseReminders(f.db, shop.id, true);
    // Sold out: no point.
    await f.db.update(schema.variants).set({ stock: 0 }).where(eq(schema.variants.productId, f.products.projector.id));
    expect(await sendBrowseReminders(ctx, weekOn)).toEqual({ sent: 0 });
    await f.db.update(schema.variants).set({ stock: null }).where(eq(schema.variants.productId, f.products.projector.id));
    expect(await sendBrowseReminders(ctx, weekOn)).toEqual({ sent: 1 });
    expect(f.mailer.sent.at(-1)!.subject).toBe("Still thinking about the Galaxy Projector?");
    // Without a store address there's no link to send.
    expect(await sendBrowseReminders({ db: f.db, mailer: f.mailer }, weekOn)).toEqual({ sent: 0 });

    // Sales from the email's link count.
    const { order } = await startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address, lines: [{ variantId: lamp!.id, quantity: 2 }], visitSource: "browse-reminder" });
    const { body, signature } = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    expect(await browseReminderStats(f.db, shop.id, weekOn)).toEqual({ sent: 1, orders: 1, salesMinor: order.totalMinor });
  });
});
