import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  addShippingRate, createDiscount, createShippingZone, createShop, deleteShippingRate, deleteShippingZone, DemoModel, describeShipping, exportStore,
  importStore, listShippingZones, quoteCart, setUpStarterZones, shipsTo, signUp, startCheckout, updateShippingZone,
} from "../src";
import { makeFixture } from "../evals/fixture";

const address = (country: string) => ({ name: "Ada Lovelace", line1: "1 Main St", city: "Somewhere", postalCode: "12345", country });

async function setup() {
  const f = await makeFixture(new DemoModel());
  const [lamp] = await f.variants(f.products.lamp.id);
  return { ...f, lamp: lamp!, lines: [{ variantId: lamp!.id, quantity: 1 }] };
}

describe("shipping zones", () => {
  it("a store without zones keeps the built-in rate and ships everywhere", async () => {
    const f = await setup();
    const shop = await f.shop();
    expect(await listShippingZones(f.db, shop.id)).toMatchObject({ isDefault: true });
    expect((await quoteCart(f.db, shop, f.lines)).shippingMinor).toBe(499);
    expect((await quoteCart(f.db, shop, [{ variantId: f.lamp.id, quantity: 10 }])).shippingMinor).toBe(0); // over 50
    expect((await quoteCart(f.db, shop, f.lines, { country: "JP" })).shipping).toMatchObject({ name: "Standard" });
  });

  it("the starter zones charge by country, and the buyer picks a rate at checkout", async () => {
    const f = await setup();
    const shop = await f.shop();
    await setUpStarterZones(f.db, shop);
    await expect(setUpStarterZones(f.db, shop)).rejects.toThrow("already have");
    const { zones, isDefault } = await listShippingZones(f.db, shop.id);
    expect(isDefault).toBe(false);
    expect(zones.map((z) => [z.name, z.countries, z.rates.map((r) => r.name)])).toEqual([
      ["United States", ["US"], ["Standard", "Express"]],
      ["International", ["*"], ["Standard"]],
    ]);
    expect(shipsTo(zones)).toContain("JP");
    expect(await describeShipping(f.db, shop)).toContain("United States: Standard: $4.99, free over $50.00 (5–10 days); Express: $14.99 (2–4 days)");

    // The cart shows the cheapest rate for the store's own country.
    expect((await quoteCart(f.db, shop, f.lines)).shipping).toMatchObject({ name: "Standard" });
    const express = zones[0]!.rates[1]!;
    const { order } = await startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address: address("US"), lines: f.lines, shippingRateId: express.id });
    expect(order).toMatchObject({ shippingMinor: 1499, shippingMethod: "Express" });
    // A rate from another zone isn't allowed for the address: the cheapest one there is used.
    const { order: de } = await startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address: address("DE"), lines: f.lines, shippingRateId: express.id });
    expect(de).toMatchObject({ shippingMinor: 1499, shippingMethod: "Standard" });
    // A free shipping code still wins.
    await createDiscount(f.db, shop.id, { code: "SHIPFREE", kind: "free_shipping", value: 0 });
    expect((await quoteCart(f.db, shop, f.lines, { country: "US", shippingRateId: express.id, discountCode: "SHIPFREE" })).shippingMinor).toBe(0);
  });

  it("zones are checked, and a country no zone covers can't check out", async () => {
    const f = await setup();
    const shop = await f.shop();
    const eu = await createShippingZone(f.db, shop.id, { name: "Europe", countries: ["DE", "FR"] });
    await expect(createShippingZone(f.db, shop.id, { name: "Germany", countries: ["DE"] })).rejects.toThrow("Germany is already in Europe");
    await expect(createShippingZone(f.db, shop.id, { name: "Nowhere", countries: [] })).rejects.toThrow("at least one country");
    await expect(createShippingZone(f.db, shop.id, { name: "Mars", countries: ["XX"] })).rejects.toThrow("isn't one we ship to");
    await expect(addShippingRate(f.db, shop.id, eu.id, { name: "Slow", priceMinor: 500, freeOverMinor: null, minDays: 9, maxDays: 3 })).rejects.toThrow("can't be slower");
    const rate = await addShippingRate(f.db, shop.id, eu.id, { name: "Standard", priceMinor: 799, freeOverMinor: 10_000, minDays: 3, maxDays: 6 });

    // A zone without rates, and countries in no zone, can't be shipped to.
    expect((await quoteCart(f.db, shop, f.lines)).shipping).toBeNull(); // the store is in the US: estimate unknown
    await expect(startCheckout(f.db, f.payments, shop, { email: "a@example.com", address: address("US"), lines: f.lines })).rejects.toThrow("doesn't ship to United States yet");
    const { order } = await startCheckout(f.db, f.payments, shop, { email: "a@example.com", address: address("FR"), lines: f.lines });
    expect(order).toMatchObject({ shippingMinor: 799, shippingMethod: "Standard" });
    expect(shipsTo((await listShippingZones(f.db, shop.id)).zones)).toEqual(["DE", "FR"]);

    await updateShippingZone(f.db, shop.id, eu.id, { name: "Europe", countries: ["DE", "FR", "US"] });
    expect((await quoteCart(f.db, shop, f.lines, { country: "US" })).shippingMinor).toBe(799);
    for (let i = 0; i < 4; i++) await addShippingRate(f.db, shop.id, eu.id, { name: `Rate ${i}`, priceMinor: 1000 + i, freeOverMinor: null, minDays: null, maxDays: null });
    await expect(addShippingRate(f.db, shop.id, eu.id, { name: "Sixth", priceMinor: 1, freeOverMinor: null, minDays: null, maxDays: null })).rejects.toThrow("Up to 5");

    // Another store can't touch these.
    const user = await signUp(f.db, { email: "other@example.com", password: "correct horse" });
    const other = await createShop(f.db, user.id, { name: "Other", country: "US" });
    await expect(deleteShippingRate(f.db, other.id, rate.id)).rejects.toThrow("not found");
    await expect(deleteShippingZone(f.db, other.id, eu.id)).rejects.toThrow("not found");

    // Zones and rates travel in the store file.
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, JSON.parse(JSON.stringify(await exportStore(f.db, shop.id))));
    const copied = await listShippingZones(f.db, copy.id);
    expect(copied.zones[0]).toMatchObject({ name: "Europe", countries: ["DE", "FR", "US"] });
    expect(copied.zones[0]!.rates).toHaveLength(5);

    await deleteShippingRate(f.db, shop.id, rate.id);
    await deleteShippingZone(f.db, shop.id, eu.id);
    expect(await f.db.query.shippingRates.findMany({ where: eq(schema.shippingRates.zoneId, eu.id) })).toHaveLength(0);
    expect((await listShippingZones(f.db, shop.id)).isDefault).toBe(true);
  });

  it("tells the cart how far it is from free shipping, for where the buyer seems to be", async () => {
    const f = await setup();
    const shop = await f.shop();
    // Built-in rate: $4.99, free over $50.
    expect((await quoteCart(f.db, shop, f.lines)).freeShipping).toEqual({ overMinor: 5000, shortByMinor: 5000 - f.lamp.priceMinor });
    expect((await quoteCart(f.db, shop, [{ variantId: f.lamp.id, quantity: 10 }])).freeShipping).toEqual({ overMinor: 5000, shortByMinor: 0 });

    const uk = await createShippingZone(f.db, shop.id, { name: "UK", countries: ["GB"] });
    await addShippingRate(f.db, shop.id, uk.id, { name: "Royal Mail", priceMinor: 799, freeOverMinor: 8000, minDays: null, maxDays: null });
    await addShippingRate(f.db, shop.id, uk.id, { name: "Courier", priceMinor: 1299, freeOverMinor: 12000, minDays: null, maxDays: null });
    const us = await createShippingZone(f.db, shop.id, { name: "US", countries: ["US"] });
    await addShippingRate(f.db, shop.id, us.id, { name: "Free", priceMinor: 0, freeOverMinor: null, minDays: null, maxDays: null });
    // A buyer in the UK sees the lowest UK threshold; the store's own country ships free anyway.
    const fromUk = await quoteCart(f.db, shop, f.lines, { countryHint: "GB" });
    expect(fromUk).toMatchObject({ shippingMinor: 799, freeShipping: { overMinor: 8000 } });
    expect((await quoteCart(f.db, shop, f.lines)).freeShipping).toBeNull();
    // A country the store doesn't ship to falls back to the store's own country.
    expect(await quoteCart(f.db, shop, f.lines, { countryHint: "JP" })).toMatchObject({ shippingMinor: 0, freeShipping: null });
    // A free-shipping code makes the goal moot.
    await createDiscount(f.db, shop.id, { code: "SHIPFREE", kind: "free_shipping", value: 0 });
    expect((await quoteCart(f.db, shop, f.lines, { countryHint: "GB", discountCode: "SHIPFREE" })).freeShipping).toBeNull();
  });
});
