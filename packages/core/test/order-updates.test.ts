import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, emailOrderUpdate, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Grace Hopper", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
const message = "Our supplier is running a few days behind, so your order will ship by Friday.\r\n\r\n\r\nThanks for waiting!";

describe("emailing an update to the buyers of picked orders", () => {
  it("emails paid orders once, by name with their order link, and skips the rest", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const a = await f.waitingOrder();
    const b = await f.order(f.products.lamp.id, { name: "Ada Byron" });
    const [lamp] = await f.variants(f.products.lamp.id);
    const { order: unpaid } = await startCheckout(f.db, f.payments, shop, { email: "unpaid@example.com", address, lines: [{ variantId: lamp!.id, quantity: 1 }] });
    const refunded = await f.order(f.products.lamp.id);
    await f.db.update(schema.orders).set({ paymentStatus: "refunded" }).where(eq(schema.orders.id, refunded.id));

    await expect(emailOrderUpdate(f.ctx, shop.id, [a.id], { message: "  " })).rejects.toThrow("Write the update");
    await expect(emailOrderUpdate(f.ctx, shop.id, [a.id], { message: "x".repeat(1001) })).rejects.toThrow("under 1,000 characters");
    await expect(emailOrderUpdate(f.ctx, shop.id, ["nope"], { message })).rejects.toThrow("Pick at least one order");

    const ids = [a.id, b.id, unpaid.id, refunded.id];
    expect(await emailOrderUpdate(f.ctx, shop.id, ids, { message })).toEqual({ sent: 2, failed: 0, skipped: 2 });
    const mail = f.mailer.sent.find((m) => m.to === b.email && m.subject.startsWith("An update"))!;
    expect(mail.subject).toBe(`An update on your order #${b.number} from Glow Lamps`);
    expect(mail.text).toBe(
      `Hi Ada,\n\nOur supplier is running a few days behind, so your order will ship by Friday.\n\nThanks for waiting!\n\nYour order #${b.number}: https://${shop.handle}.example/orders/${b.paymentIntentId}\n\nReply to this email if you have a question.`,
    );
    expect(f.mailer.sent.some((m) => m.to === "unpaid@example.com")).toBe(false);
    // It's on the order's timeline of emails.
    expect(await f.db.query.emails.findMany({ where: eq(schema.emails.orderId, a.id) })).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "order_news", status: "sent" })]));

    // Pressing send twice doesn't email anyone again; a different update does go out.
    expect(await emailOrderUpdate(f.ctx, shop.id, ids, { message })).toEqual({ sent: 0, failed: 0, skipped: 4 });
    expect(await emailOrderUpdate(f.ctx, shop.id, [a.id], { message: "One more thing: tracking is on its way." })).toEqual({ sent: 1, failed: 0, skipped: 0 });

    // When the mail server is down, the order page shows the email as not sent.
    const failing = { ...f.ctx, mailer: { name: "log" as const, send: async (): Promise<{ id: string }> => { throw new Error("Mail server down"); } } };
    expect(await emailOrderUpdate(failing, shop.id, [a.id, b.id], { message: "Sorry, one more update." })).toEqual({ sent: 0, failed: 2, skipped: 0 });
    const failed = await f.db.query.emails.findMany({ where: eq(schema.emails.status, "failed") });
    expect(failed.map((e) => e.error)).toEqual(["Mail server down", "Mail server down"]);
  });
});
