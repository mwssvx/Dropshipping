import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, handlePaymentEvent, listDiscounts, personalCodesFor, sendPersonalCode, startCheckout } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("personal codes", () => {
  it("emails one customer a one-time code that only works with their email, and shows whether they used it", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const first = await f.waitingOrder();
    const customer = (await f.db.query.customers.findFirst({ where: eq(schema.customers.email, first.email!) }))!;
    const ctx = { db: f.db, mailer: f.mailer, storeAddress: () => "https://glow.example", now: () => new Date() };

    await expect(sendPersonalCode(ctx, shop, customer.id, { kind: "percent", value: 120, days: 30 })).rejects.toThrow("between 1 and 100");
    await expect(sendPersonalCode(ctx, shop, customer.id, { kind: "amount", value: 500, days: 120 })).rejects.toThrow("1 to 90 days");
    const code = await sendPersonalCode(ctx, shop, customer.id, { kind: "amount", value: 500, days: 30, note: "Sorry your parcel took so long." });
    expect(code).toMatchObject({ source: "personal", usageLimit: 1, email: customer.email, value: 500 });
    expect(code.code).toMatch(/^FOR-[A-Z2-9]{6}$/);
    const mail = f.mailer.sent.at(-1)!;
    expect(mail).toMatchObject({ to: customer.email, subject: "$5.00 off your next order at Glow Lamps" });
    expect(mail.text).toContain("Sorry your parcel took so long.\n\nHere's $5.00 off");
    expect(mail.text).toContain(`https://glow.example/discount/${code.code}`);
    // Not on the Marketing codes list; on their page.
    expect(await listDiscounts(f.db, shop.id)).toEqual([]);
    expect(await personalCodesFor(f.db, shop.id, customer.email)).toMatchObject([{ code: code.code, status: "open" }]);

    const [lamp] = await f.variants(f.products.lamp.id);
    const checkout = (email: string) => startCheckout(f.db, f.payments, shop, { email, address, lines: [{ variantId: lamp!.id, quantity: 1 }], discountCode: code.code });
    await expect(checkout("someone@example.com")).rejects.toThrow("was sent to a different email address");
    const { order } = await checkout(customer.email);
    expect(order.discountMinor).toBe(500);
    const { body, signature } = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    expect(await personalCodesFor(f.db, shop.id, customer.email)).toMatchObject([{ status: "used", orderNumber: order.number }]);
    await expect(checkout(customer.email)).rejects.toThrow(/used/);

    // Expired ones say so.
    const later = await sendPersonalCode(ctx, shop, customer.id, { kind: "percent", value: 10, days: 1 });
    expect((await personalCodesFor(f.db, shop.id, customer.email, new Date(Date.now() + 2 * DAY)))[0]).toMatchObject({ code: later.code, status: "expired" });
  });
});
