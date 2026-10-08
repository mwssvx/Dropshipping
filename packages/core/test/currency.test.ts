import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  buyerAmounts, buyerOrders, convertAmount, convertPrice, createShop, crossRate, currencyForCountry, DemoModel, displayFx, EcbFx, exportStore, handlePaymentEvent,
  importStore, listRefunds, noConversion, onOrderPaid, parseEcb, presentQuote, refundOrder, setShopCurrencies, shopCurrencies, signUp, startCheckout, StaticFx,
} from "../src";
import { makeFixture } from "../evals/fixture";

const ECB = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope><Cube><Cube time='2026-10-07'>
<Cube currency='USD' rate='1.1000'/><Cube currency='JPY' rate='160.10'/><Cube currency='GBP' rate='0.8800'/><Cube currency='CAD' rate='1.5000'/>
</Cube></Cube></gesmes:Envelope>`;

const address = { name: "Marie Curie", line1: "1 Rue de Rivoli", city: "Paris", region: "", postalCode: "75001", country: "FR" };

describe("exchange rates", () => {
  it("reads the European Central Bank's daily file", () => {
    const sheet = parseEcb(ECB);
    expect(sheet.asOf).toBe("2026-10-07");
    expect(sheet.rates).toMatchObject({ EUR: 1, USD: 1.1, GBP: 0.88, CAD: 1.5 });
    expect(crossRate(sheet.rates, "USD", "EUR")).toBeCloseTo(1 / 1.1);
    expect(crossRate(sheet.rates, "USD", "GBP")).toBeCloseTo(0.8);
    expect(() => parseEcb("<Cube currency='USD' rate='1.1'/>")).toThrow("No GBP rate");
  });

  it("keeps the last good rates when the bank can't be reached", async () => {
    let ok = true;
    const fetcher = vi.fn(async () => (ok ? new Response(ECB) : new Response("down", { status: 503 })));
    const fx = new EcbFx(new StaticFx(), fetcher as unknown as typeof fetch);
    expect((await fx.rates()).asOf).toBe("2026-10-07");
    // Cached for six hours: no second request.
    await fx.rates();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    ok = false;
    const fresh = new EcbFx(new StaticFx(), fetcher as unknown as typeof fetch);
    expect((await fresh.rates()).asOf).toBe("fixed rates for testing");
    errors.mockRestore();
  });

  it("rounds product prices up to .99 when the store wants that, and nothing else", () => {
    const fx = { currency: "EUR", rate: 0.92, round: true };
    expect(convertPrice(2500, fx)).toBe(2399); // 23.00 → 23.99
    expect(convertPrice(2450, fx)).toBe(2299); // 22.54 → 22.99
    expect(convertPrice(2174, fx)).toBe(2099); // exactly 20.00 → 20.99
    expect(convertPrice(80, fx)).toBe(74); // under 1.00 stays exact
    expect(convertPrice(2500, { ...fx, round: false })).toBe(2300);
    expect(convertAmount(599, fx)).toBe(551);
    expect(convertPrice(2500, noConversion("USD"))).toBe(2500);
  });

  it("offers only the currencies the store turned on, and picks one from the buyer's country", async () => {
    const shop = { currency: "USD", presentmentCurrencies: ["EUR", "GBP"], roundConvertedPrices: true };
    expect(shopCurrencies(shop)).toEqual(["USD", "EUR", "GBP"]);
    expect(currencyForCountry(shop, "fr")).toBe("EUR");
    expect(currencyForCountry(shop, "GB")).toBe("GBP");
    expect(currencyForCountry(shop, "CA")).toBeNull();
    expect(currencyForCountry(shop, "JP")).toBeNull();
    const fx = new StaticFx();
    expect(await displayFx(fx, shop, "CAD")).toEqual(noConversion("USD"));
    expect(await displayFx(fx, shop, null)).toEqual(noConversion("USD"));
    expect(await displayFx(fx, shop, "EUR")).toEqual({ currency: "EUR", rate: Number((1 / 1.08).toFixed(6)), round: true });
  });

  it("builds a cart total from the prices the buyer saw", () => {
    const fx = { currency: "EUR", rate: 0.9, round: true };
    const p = presentQuote(
      { items: [{ variantId: "a", unitPriceMinor: 2500, quantity: 2 }, { variantId: "b", unitPriceMinor: 1000, quantity: 1 }], discountMinor: 600, shippingMinor: 500, taxMinor: 300, pricesIncludeTax: false },
      fx,
    );
    // 22.50 → 22.99 and 9.00 → 9.99
    expect(p.units).toEqual({ a: 2299, b: 999 });
    expect(p.subtotalMinor).toBe(2299 * 2 + 999);
    expect(p).toMatchObject({ currency: "EUR", discountMinor: 540, shippingMinor: 450, taxMinor: 270 });
    expect(p.totalMinor).toBe(p.subtotalMinor - 540 + 450 + 270);
    expect(presentQuote({ items: [{ variantId: "a", unitPriceMinor: 2500, quantity: 1 }], discountMinor: 0, shippingMinor: 0, taxMinor: 200, pricesIncludeTax: true }, fx).totalMinor).toBe(2299);
  });
});

describe("selling in the buyer's currency", () => {
  async function setup() {
    const f = await makeFixture(new DemoModel());
    const s = await f.shop();
    await setShopCurrencies(f.db, s, { currencies: ["EUR", "GBP", "USD"], round: true });
    const shop = await f.shop();
    const [lamp] = await f.variants(f.products.lamp.id);
    const fx = await displayFx(new StaticFx(), shop, "EUR");
    return { ...f, shop, lamp: lamp!, fx };
  }

  it("charges what the buyer saw in euros and keeps the store's books in dollars", async () => {
    const f = await setup();
    expect(f.shop.presentmentCurrencies).toEqual(["EUR", "GBP"]);
    const charge = vi.spyOn(f.payments, "createPaymentIntent");
    const { order } = await startCheckout(f.db, f.payments, f.shop, { email: "marie@example.com", address, lines: [{ variantId: f.lamp.id, quantity: 2 }], fx: f.fx });

    expect(order.currency).toBe("USD");
    expect(order.presentment).toMatchObject({ currency: "EUR", rate: f.fx.rate });
    const unit = convertPrice(f.lamp.priceMinor, f.fx);
    expect(order.presentment!.units[f.lamp.id]).toBe(unit);
    expect(unit % 100).toBe(99);
    expect(charge).toHaveBeenCalledWith(expect.objectContaining({ currency: "EUR", amountMinor: order.presentment!.totalMinor, applicationFeeMinor: convertAmount(order.platformFeeMinor, f.fx) }));

    // The payment has to match the euro amount, not the dollar one.
    const wrong = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
    await expect(handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(wrong.body, wrong.signature))!)).rejects.toThrow("Amount mismatch");
    const right = f.payments.succeededEvent(order.paymentIntentId!, order.presentment!.totalMinor);
    expect(await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(right.body, right.signature))!)).toMatchObject({ becamePaid: true });

    // The receipt and the buyer's account show euros.
    await onOrderPaid(f.ctx, order.id);
    const receipt = f.mailer.sent.find((m) => m.subject === `Order #${order.number} confirmed`)!;
    expect(receipt.text).toContain(`Total paid: €${(order.presentment!.totalMinor / 100).toFixed(2)}`);
    expect(receipt.text).toContain(`€${((unit * 2) / 100).toFixed(2)}`);
    const [mine] = await buyerOrders(f.db, f.shop.id, "marie@example.com");
    expect(mine).toMatchObject({ currency: "EUR", totalMinor: order.presentment!.totalMinor });
  });

  it("ignores a currency the store doesn't sell in", async () => {
    const f = await setup();
    const { order } = await startCheckout(f.db, f.payments, f.shop, { email: "a@example.com", address, lines: [{ variantId: f.lamp.id, quantity: 1 }], fx: noConversion("USD") });
    expect(order.presentment).toBeNull();
    await expect(setShopCurrencies(f.db, f.shop, { currencies: ["JPY"], round: true })).rejects.toThrow("don't support JPY");
  });

  it("refunds in the buyer's currency, and a full refund returns exactly what they paid", async () => {
    const f = await setup();
    const { order } = await startCheckout(f.db, f.payments, f.shop, { email: "marie@example.com", address, lines: [{ variantId: f.lamp.id, quantity: 3 }], fx: f.fx });
    const ev = f.payments.succeededEvent(order.paymentIntentId!, order.presentment!.totalMinor);
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(ev.body, ev.signature))!);
    const refund = vi.spyOn(f.payments, "refund");

    const part = 1000;
    await refundOrder(f.ctx, f.shop.id, order.id, { amountMinor: part });
    expect(refund).toHaveBeenLastCalledWith(expect.objectContaining({ amountMinor: Math.round(part * f.fx.rate) }));
    await refundOrder(f.ctx, f.shop.id, order.id, {});
    expect(refund).toHaveBeenLastCalledWith(expect.objectContaining({ amountMinor: order.presentment!.totalMinor - Math.round(part * f.fx.rate) }));

    const rows = await listRefunds(f.db, order.id);
    expect(rows.reduce((s, r) => s + r.presentmentAmountMinor!, 0)).toBe(order.presentment!.totalMinor);
    const after = (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
    expect(after.refundedMinor).toBe(after.totalMinor);
    expect(buyerAmounts(after)).toMatchObject({ currency: "EUR", refundedMinor: order.presentment!.totalMinor });
  });

  it("carries the currency settings in the store file", async () => {
    const f = await setup();
    const file = await exportStore(f.db, f.shop.id);
    expect(file.store).toMatchObject({ presentment_currencies: ["EUR", "GBP"], round_converted_prices: true });
    const owner = await signUp(f.db, { email: "second@example.com", password: "correct horse" });
    const fresh = await createShop(f.db, owner.id, { name: "Second Store", country: "US" });
    await f.db.update(schema.shops).set({ roundConvertedPrices: false }).where(eq(schema.shops.id, fresh.id));
    await importStore(f.db, fresh.id, JSON.parse(JSON.stringify(file)));
    expect(await f.db.query.shops.findFirst({ where: eq(schema.shops.id, fresh.id) })).toMatchObject({ presentmentCurrencies: ["EUR", "GBP"], roundConvertedPrices: true });
  });
});
