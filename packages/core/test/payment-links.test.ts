import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { countUnpaidLinks, createPaymentLink, DemoModel, handlePaymentEvent, MAX_LINK_SENDS, resendPaymentLink, sendAbandonedCartEmails } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Grace Hopper", line1: "1 Navy Way", city: "Arlington", region: "VA", postalCode: "22201", country: "US" };

describe("payment links", () => {
  it("the merchant builds an order, the buyer is emailed a link, and paying makes it a normal order", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const [lamp] = await f.variants(f.products.lamp.id);
    const ctx = { ...f.ctx, payUrl: (_: unknown, o: { id: string }) => `https://glow.example/pay/${o.id}` };
    await expect(createPaymentLink(ctx, shop, { email: "grace@example.com", address, lines: [{ variantId: lamp!.id, quantity: 0 }] })).rejects.toThrow("at least one product");

    const { order, sent } = await createPaymentLink(ctx, shop, { email: "grace@example.com", address, lines: [{ variantId: lamp!.id, quantity: 2 }], note: "As we discussed on Instagram: two lamps, gift wrapped." });
    expect(sent).toBe(true);
    expect(order).toMatchObject({ source: "payment_link", paymentStatus: "pending", note: "As we discussed on Instagram: two lamps, gift wrapped." });
    const mail = f.mailer.sent.at(-1)!;
    expect(mail).toMatchObject({ to: "grace@example.com", subject: "Your order from Glow Lamps is ready to pay" });
    expect(mail.text).toContain(`Pay securely here: https://glow.example/pay/${order.id}`);
    expect(mail.text).toContain("two lamps, gift wrapped");
    expect(await countUnpaidLinks(f.db, shop.id)).toBe(1);

    // Not treated as an abandoned checkout.
    expect((await sendAbandonedCartEmails(f.ctx, new Date(Date.now() + 2 * 3_600_000))).sent).toBe(0);

    await resendPaymentLink(ctx, shop.id, order.id);
    for (let i = 2; i < MAX_LINK_SENDS; i++) await resendPaymentLink(ctx, shop.id, order.id);
    await expect(resendPaymentLink(ctx, shop.id, order.id)).rejects.toThrow(`emailed ${MAX_LINK_SENDS} times`);

    const { body, signature } = f.payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor });
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    expect((await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!.paymentStatus).toBe("paid");
    expect(await countUnpaidLinks(f.db, shop.id)).toBe(0);
    await expect(resendPaymentLink(ctx, shop.id, order.id)).rejects.toThrow("already paid");
    // Ordinary checkouts aren't payment links.
    const normal = await f.waitingOrder();
    await expect(resendPaymentLink(ctx, shop.id, normal.id)).rejects.toThrow("not found");
  });
});
