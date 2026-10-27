import { describe, expect, it } from "vitest";
import { schema } from "@sf/db";
import { eq } from "drizzle-orm";
import { buyerAmounts, DemoModel, exportStore, handlePaymentEvent, invoiceDocument, issueInvoice, ordersCsv, protectionFee, setDeliveryProtection, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("delivery protection", () => {
  it("prices a share of the items, with a floor", () => {
    expect(protectionFee({ percent: 3, minMinor: 100 }, 10_000)).toBe(300);
    expect(protectionFee({ percent: 3, minMinor: 100 }, 1_000)).toBe(100);
    expect(protectionFee({ percent: 3, minMinor: 100 }, 0)).toBe(0);
  });

  it("is added only when the store offers it and the buyer ticks it", async () => {
    const f = await makeFixture(new DemoModel());
    const [v] = await f.variants(f.products.lamp.id);
    const lines = [{ variantId: v!.id, quantity: 2 }];
    const shop = await f.shop();

    await expect(setDeliveryProtection(f.db, shop.id, { percent: 20, minMinor: 100 })).rejects.toThrow("Pick between 0.5% and 10%");
    // Ticked before the store offers it: nothing is added.
    const { order: before } = await startCheckout(f.db, f.payments, await f.shop(), { email: "ada@example.com", address, lines, protection: true });
    expect(before.protectionMinor).toBe(0);

    await setDeliveryProtection(f.db, shop.id, { percent: 3, minMinor: 150 });
    const { order: plain } = await startCheckout(f.db, f.payments, await f.shop(), { email: "ada@example.com", address, lines });
    expect(plain.protectionMinor).toBe(0);
    const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email: "ada@example.com", address, lines, protection: true });
    const fee = protectionFee({ percent: 3, minMinor: 150 }, order.subtotalMinor - order.discountMinor);
    expect(order.protectionMinor).toBe(fee);
    expect(order.totalMinor).toBe(plain.totalMinor + fee);

    // An after-checkout offer on it doesn't add protection of its own.
    const { order: child } = await startCheckout(f.db, f.payments, await f.shop(), { email: "ada@example.com", address, lines, protection: true, followUp: { parentOrderId: order.id, percentOff: 10 } });
    expect(child.protectionMinor).toBe(0);

    const { body, signature } = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    const paid = (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
    expect(buyerAmounts(paid).protectionMinor).toBe(fee);
    const doc = await invoiceDocument(f.db, shop.id, (await issueInvoice(f.db, order.id))!.id);
    expect(doc.protectionMinor).toBe(fee);

    const csv = (await ordersCsv(f.db, shop.id)).split("\n").map((r) => r.split(","));
    const at = csv[0]!.indexOf("Delivery protection");
    expect(csv.some((r) => r[at] === (fee / 100).toFixed(2))).toBe(true);
    expect((await exportStore(f.db, shop.id)).store.delivery_protection).toEqual({ percent: 3, min_minor: 150 });

    await setDeliveryProtection(f.db, shop.id, null);
    expect((await f.shop()).deliveryProtection).toBeNull();
  });

  it("is converted for a buyer shopping in another currency", async () => {
    const f = await makeFixture(new DemoModel());
    const [v] = await f.variants(f.products.lamp.id);
    const shop = await f.shop();
    await setDeliveryProtection(f.db, shop.id, { percent: 5, minMinor: 0 });
    const { order } = await startCheckout(f.db, f.payments, await f.shop(), {
      email: "ada@example.com", address, lines: [{ variantId: v!.id, quantity: 1 }], protection: true, fx: { currency: "EUR", rate: 0.9, round: false },
    });
    expect(order.presentment!.protectionMinor).toBe(Math.round(order.protectionMinor * 0.9));
    const p = order.presentment!;
    expect(p.totalMinor).toBe(p.subtotalMinor - p.discountMinor + p.shippingMinor + p.protectionMinor! + p.taxMinor);
  });
});
