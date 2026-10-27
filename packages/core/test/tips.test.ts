import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { buyerAmounts, createProduct, DemoModel, handlePaymentEvent, invoiceDocument, onOrderPaid, orderDocuments, ordersCsv, setTipping, startCheckout, tipAmount } from "../src";
import { makeFixture } from "../evals/fixture";

const austin = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shopId = (await f.shop()).id;
  const mug = await createProduct(f.db, shopId, { title: "Mug", status: "active", variants: [{ title: "Default", priceMinor: 1550, stock: 9 }] });
  const [mugVariant] = await f.variants(mug.id);
  await setTipping(f.db, shopId, { percents: [15, 10, 20, 10], note: " Every order is packed by hand. " });
  async function checkout(opts: { tipPercent?: number; storefront?: boolean } = {}) {
    return startCheckout(f.db, f.payments, await f.shop(), {
      email: "buyer@example.com",
      address: austin,
      lines: [{ variantId: mugVariant!.id, quantity: 2 }],
      storefront: opts.storefront ?? true,
      tipPercent: opts.tipPercent,
    });
  }
  async function pay(orderId: string) {
    const order = (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) }))!;
    const { body, signature } = f.payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor });
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    await onOrderPaid(f.ctx, order.id);
    return (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
  }
  return { ...f, shopId, checkout, pay };
}

describe("tips at checkout", () => {
  it("adds the buyer's pick on the goods, untaxed and outside our fee, and shows it on the receipt, invoice and export", async () => {
    const f = await setup();
    expect((await f.shop()).tipping).toEqual({ percents: [10, 15, 20], note: "Every order is packed by hand." });
    const plain = (await f.checkout()).order;
    expect(plain.tipMinor).toBe(0);

    const { order, quote } = await f.checkout({ tipPercent: 15 });
    // 15% of $31.00 is $4.65.
    expect(order.tipMinor).toBe(465);
    expect(order.totalMinor).toBe(plain.totalMinor + 465);
    expect(quote.totalMinor).toBe(order.totalMinor);
    expect(order.taxMinor).toBe(plain.taxMinor);
    expect(order.platformFeeMinor).toBe(plain.platformFeeMinor);
    expect(buyerAmounts(order).tipMinor).toBe(465);

    const paid = await f.pay(order.id);
    expect(f.mailer.sent.find((m) => m.subject === `Order #${paid.number} confirmed`)!.text).toContain("Includes a tip: $4.65");
    const doc = await invoiceDocument(f.db, f.shopId, (await orderDocuments(f.db, paid.id))[0]!.id);
    expect(doc.tipMinor).toBe(465);
    const [head, ...rows] = (await ordersCsv(f.db, f.shopId)).trim().split("\n");
    const col = head!.split(",").indexOf("Tip");
    expect(rows.map((r) => r.split(",")[col])).toContain("4.65");
  });

  it("only takes the store's own amounts, on its own checkout, and is off unless the store asks", async () => {
    const f = await setup();
    await expect(f.checkout({ tipPercent: 50 })).rejects.toThrow("Pick one of the tip amounts");
    // Payment links and the API don't ask for tips.
    expect((await f.checkout({ tipPercent: 10, storefront: false })).order.tipMinor).toBe(0);
    await setTipping(f.db, f.shopId, null);
    expect((await f.checkout({ tipPercent: 10 })).order.tipMinor).toBe(0);
    await expect(setTipping(f.db, f.shopId, { percents: [] })).rejects.toThrow("at least one");
    await expect(setTipping(f.db, f.shopId, { percents: [5, 10, 15, 20] })).rejects.toThrow("up to 3");
    await expect(setTipping(f.db, f.shopId, { percents: [40] })).rejects.toThrow("between 1% and 30%");
    expect(tipAmount(999, 15)).toBe(150);
    expect(tipAmount(0, 15)).toBe(0);
  });
});
