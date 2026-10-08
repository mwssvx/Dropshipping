import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, schema, type Db } from "@sf/db";
import {
  addTaxRegistration,
  BuiltInTaxCalculator,
  createProduct,
  createShop,
  FakePaymentProvider,
  FakeSupplier,
  handlePaymentEvent,
  LogMailer,
  platformFeeFor,
  refundOrder,
  regionCode,
  signUp,
  startCheckout,
  suppliersFrom,
  taxOn,
  taxRateFor,
  taxReport,
  UserError,
} from "../src";

const tax = new BuiltInTaxCalculator();
let db: Db;
let payments: FakePaymentProvider;

beforeEach(async () => {
  db = await createTestDb();
  payments = new FakePaymentProvider();
});

async function storeIn(country: string) {
  const user = await signUp(db, { email: `owner-${country}@example.com`, password: "correct horse" });
  const shop = await createShop(db, user.id, { name: `Shop ${country}`, country });
  const product = await createProduct(db, shop.id, {
    title: "Lamp",
    descriptionHtml: "",
    imageUrl: "",
    status: "active",
    variants: [{ title: "Default", priceMinor: 6000, compareAtMinor: null, costMinor: 2000 }],
  });
  const variant = (await db.query.variants.findFirst({ where: eq(schema.variants.productId, product.id) }))!;
  return { shop, variant };
}

const fresh = async (id: string) => (await db.query.shops.findFirst({ where: eq(schema.shops.id, id) }))!;

async function buy(s: Awaited<ReturnType<typeof storeIn>>, address: { country: string; region?: string; postalCode?: string }) {
  const { order } = await startCheckout(
    db,
    payments,
    await fresh(s.shop.id),
    {
      email: "buyer@example.com",
      address: { name: "Bo Buyer", line1: "1 High St", city: "Town", postalCode: address.postalCode ?? "12345", ...address },
      lines: [{ variantId: s.variant.id, quantity: 1 }],
    },
    tax,
  );
  return order;
}

describe("tax rates", () => {
  it("understands state and province names", () => {
    expect(regionCode("US", "Texas")).toBe("TX");
    expect(regionCode("US", "tx.")).toBe("TX");
    expect(regionCode("US", "Ontario")).toBeNull();
    expect(regionCode("CA", "ontario")).toBe("ON");
    expect(regionCode("GB", "London")).toBeNull();
  });

  it("adds tax on top, or takes it out of a price that includes it", () => {
    expect(taxOn(10_000, 625, false)).toBe(625);
    expect(taxOn(12_000, 2000, true)).toBe(2000);
    expect(taxOn(999, 1900, true)).toBe(160);
  });

  it("charges only where the store is registered, at the buyer's rate", () => {
    expect(taxRateFor({ country: "US", region: "TX" }, [])).toBeNull();
    expect(taxRateFor({ country: "US", region: "TX" }, ["US-CA"])).toBeNull();
    expect(taxRateFor({ country: "US", region: "Texas" }, ["US-TX"])).toMatchObject({ ratePct: 6.25 });
    expect(taxRateFor({ country: "DE" }, ["EU"])).toMatchObject({ jurisdiction: "EU-DE", ratePct: 19 });
    expect(taxRateFor({ country: "FR" }, ["EU"])).toMatchObject({ ratePct: 20 });
    expect(taxRateFor({ country: "CA", region: "ON" }, ["CA"])).toMatchObject({ label: "HST", ratePct: 13 });
    expect(taxRateFor({ country: "CA", region: "BC" }, ["CA"])).toMatchObject({ label: "GST", ratePct: 5 });
    expect(taxRateFor({ country: "GB" }, ["EU"])).toBeNull();
  });
});

describe("tax at checkout", () => {
  it("leaves tax off until the store registers somewhere", async () => {
    const s = await storeIn("US");
    const order = await buy(s, { country: "US", region: "TX" });
    expect(order).toMatchObject({ taxMinor: 0, totalMinor: 6000, taxIncluded: false });
  });

  it("adds US state sales tax on top of the goods, and takes no fee on the tax", async () => {
    const s = await storeIn("US");
    await addTaxRegistration(db, tax, s.shop, { jurisdiction: "US-TX" });
    const order = await buy(s, { country: "US", region: "Texas" });
    expect(order).toMatchObject({ subtotalMinor: 6000, shippingMinor: 0, taxMinor: 375, totalMinor: 6375, taxIncluded: false });
    expect(order.taxBreakdown).toEqual([{ jurisdiction: "US-TX", label: "Sales tax (TX) 6.25%", rateBps: 625, amountMinor: 375 }]);
    expect(order.platformFeeMinor).toBe(platformFeeFor("free", 6000));
    // Out-of-state buyers aren't charged.
    expect((await buy(s, { country: "US", region: "OR" })).taxMinor).toBe(0);
  });

  it("includes VAT in UK and EU prices, so the buyer pays the price they saw", async () => {
    const s = await storeIn("GB");
    expect(s.shop.pricesIncludeTax).toBe(true);
    await addTaxRegistration(db, tax, s.shop, { jurisdiction: "GB", registrationNumber: "GB123456789" });
    const order = await buy(s, { country: "GB" });
    expect(order).toMatchObject({ subtotalMinor: 6000, totalMinor: 6000, taxMinor: 1000, taxIncluded: true });

    const eu = await storeIn("DE");
    await addTaxRegistration(db, tax, eu.shop, { jurisdiction: "EU" });
    expect((await buy(eu, { country: "DE" })).taxMinor).toBe(958);
    expect((await buy(eu, { country: "HU" })).taxMinor).toBe(1276);
  });

  it("refunds tax in proportion and reports what's owed per place", async () => {
    const s = await storeIn("US");
    await addTaxRegistration(db, tax, s.shop, { jurisdiction: "US-TX" });
    const order = await buy(s, { country: "US", region: "TX" });
    await handlePaymentEvent(db, "fake", { id: "evt_tax_1", type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor });
    const ctx = {
      db,
      payments,
      suppliers: suppliersFrom([new FakeSupplier()]),
      mailer: new LogMailer(true),
      orderStatusUrl: () => "https://example.test/o",
    };
    const { refund } = await refundOrder(ctx, s.shop.id, order.id, { amountMinor: Math.round(order.totalMinor / 3) });
    expect(refund.taxRefundedMinor).toBe(125);

    const range = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) };
    expect(await taxReport(db, s.shop.id, range)).toEqual([
      { jurisdiction: "US-TX", label: "Sales tax (TX) 6.25%", orders: 1, salesMinor: 6000 - (2125 - 125), taxMinor: 250 },
    ]);
  });

  it("only takes places it knows, once each", async () => {
    const s = await storeIn("US");
    await expect(addTaxRegistration(db, tax, s.shop, { jurisdiction: "Mars" })).rejects.toThrow(UserError);
    await addTaxRegistration(db, tax, s.shop, { jurisdiction: "us-ny" });
    await expect(addTaxRegistration(db, tax, s.shop, { jurisdiction: "US-NY" })).rejects.toThrow(/already/);
    await expect(addTaxRegistration(db, tax, s.shop, { jurisdiction: "US-OR" })).rejects.toThrow(UserError); // no sales tax there
  });
});
