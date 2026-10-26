import { describe, expect, it } from "vitest";
import { schema } from "@sf/db";
import { eq } from "drizzle-orm";
import { addTaxRegistration, BuiltInTaxCalculator, DemoModel, exportCustomerData, handlePaymentEvent, invoiceDocument, issueInvoice, setTaxExemption, startCheckout, taxExemptionFor } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("tax-exempt buyers", () => {
  it("charges a signed-in exempt buyer no tax, and keeps the number on the order and invoice", async () => {
    const f = await makeFixture(new DemoModel());
    const [v] = await f.variants(f.products.lamp.id);
    const lines = [{ variantId: v!.id, quantity: 1 }];
    const shop = await f.shop();
    await addTaxRegistration(f.db, new BuiltInTaxCalculator(), shop, { jurisdiction: "US-TX" });

    const { order: taxed } = await startCheckout(f.db, f.payments, await f.shop(), { email: "ada@example.com", address, lines });
    expect(taxed.taxMinor).toBeGreaterThan(0);
    const customer = (await f.db.query.customers.findFirst({ where: eq(schema.customers.email, "ada@example.com") }))!;

    await expect(setTaxExemption(f.db, shop.id, customer.id, "x".repeat(61))).rejects.toThrow("under 60 characters");
    const saved = await setTaxExemption(f.db, shop.id, customer.id, "  TX  01-234567 ");
    expect(saved.taxExemptId).toBe("TX 01-234567");
    expect(await taxExemptionFor(f.db, shop.id, " Ada@Example.com ")).toBe("TX 01-234567");

    // Typing their email as a guest isn't enough.
    const { order: guest } = await startCheckout(f.db, f.payments, await f.shop(), { email: "ada@example.com", address, lines });
    expect(guest.taxMinor).toBe(taxed.taxMinor);
    expect(guest.taxExemptId).toBeNull();

    const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email: "ada@example.com", address, lines, buyerEmail: "ada@example.com" });
    expect(order.taxMinor).toBe(0);
    expect(order.taxBreakdown).toEqual([]);
    expect(order.taxExemptId).toBe("TX 01-234567");
    expect(order.totalMinor).toBe(taxed.totalMinor - taxed.taxMinor);

    // An after-checkout offer on that order follows it.
    const { order: child } = await startCheckout(f.db, f.payments, await f.shop(), { email: "ada@example.com", address, lines, followUp: { parentOrderId: order.id, percentOff: 10 } });
    expect(child.taxMinor).toBe(0);
    expect(child.taxExemptId).toBe("TX 01-234567");

    // A payment link the merchant builds for them, too.
    const { order: link } = await startCheckout(f.db, f.payments, await f.shop(), { email: "ada@example.com", address, lines, taxExemptFor: "ada@example.com" });
    expect(link.taxMinor).toBe(0);

    const { body, signature } = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    const invoice = (await issueInvoice(f.db, order.id))!;
    const doc = await invoiceDocument(f.db, shop.id, invoice.id);
    expect(doc.taxExemptId).toBe("TX 01-234567");
    expect(doc.tax).toEqual([]);
    expect((await exportCustomerData(f.db, shop, customer.id)).customer.tax_exemption).toBe("TX 01-234567");

    // Removed: they pay tax again, and paid orders keep their record.
    await setTaxExemption(f.db, shop.id, customer.id, "");
    const { order: after } = await startCheckout(f.db, f.payments, await f.shop(), { email: "ada@example.com", address, lines, buyerEmail: "ada@example.com" });
    expect(after.taxMinor).toBe(taxed.taxMinor);
    expect((await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!.taxExemptId).toBe("TX 01-234567");
  });

  it("charges the shown price where prices include tax, with no tax recorded", async () => {
    const f = await makeFixture(new DemoModel());
    const [v] = await f.variants(f.products.lamp.id);
    const lines = [{ variantId: v!.id, quantity: 1 }];
    const shop = await f.shop();
    await addTaxRegistration(f.db, new BuiltInTaxCalculator(), shop, { jurisdiction: "US-TX" });
    await f.db.update(schema.shops).set({ pricesIncludeTax: true }).where(eq(schema.shops.id, shop.id));
    const { order: taxed } = await startCheckout(f.db, f.payments, await f.shop(), { email: "grace@example.com", address, lines });
    const customer = (await f.db.query.customers.findFirst({ where: eq(schema.customers.email, "grace@example.com") }))!;
    await setTaxExemption(f.db, shop.id, customer.id, "CH-55");
    const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email: "grace@example.com", address, lines, buyerEmail: "grace@example.com" });
    expect(taxed.taxMinor).toBeGreaterThan(0);
    expect(order.taxMinor).toBe(0);
    expect(order.totalMinor).toBe(taxed.totalMinor);
  });
});
