import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, requestOrderLink, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const MIN = 60_000;

describe("track your order", () => {
  it("emails the link to a paid order's own address, at most once every ten minutes, and never says whether it found one", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const order = await f.waitingOrder();
    expect(order.paymentStatus).toBe("paid");
    const links = () => f.mailer.sent.filter((m) => m.subject === `Your order #${order.number} from ${shop.name}`);

    await expect(requestOrderLink(f.ctx, shop, { email: "nope", number: "1001" })).rejects.toThrow("order number from your confirmation");
    await expect(requestOrderLink(f.ctx, shop, { email: order.email, number: "abc" })).rejects.toThrow("order number");
    // Wrong email or number: the same answer, and nothing is sent.
    expect(await requestOrderLink(f.ctx, shop, { email: "someone@example.com", number: String(order.number) })).toEqual({ status: "sent" });
    expect(await requestOrderLink(f.ctx, shop, { email: order.email, number: "9999" })).toEqual({ status: "sent" });
    expect(links()).toHaveLength(0);

    await requestOrderLink(f.ctx, shop, { email: ` ${order.email.toUpperCase()} `, number: `#${order.number}` });
    await requestOrderLink(f.ctx, shop, { email: order.email, number: String(order.number) });
    expect(links()).toHaveLength(1);
    expect(links()[0]!.to).toBe(order.email);
    expect(links()[0]!.text).toContain(await f.ctx.orderStatusUrl(shop, order));
    f.advance(11 * MIN);
    await requestOrderLink(f.ctx, shop, { email: order.email, number: String(order.number) });
    expect(links()).toHaveLength(2);
    const logged = await f.db.query.emails.findMany({ where: eq(schema.emails.orderId, order.id) });
    expect(logged.filter((e) => e.kind === "order_link")).toHaveLength(2);
  });

  it("doesn't send links to unpaid orders", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const [small] = await f.variants(f.products.lamp.id);
    const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
    const { order } = await startCheckout(f.db, f.payments, shop, { email: "unpaid@example.com", address, lines: [{ variantId: small!.id, quantity: 1 }] });
    const before = f.mailer.sent.length;
    await requestOrderLink(f.ctx, shop, { email: "unpaid@example.com", number: String(order.number) });
    expect(f.mailer.sent.length).toBe(before);
  });
});
