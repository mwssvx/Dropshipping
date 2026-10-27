import { describe, expect, it } from "vitest";
import { addShippingRate, createProduct, createShippingZone, DemoModel, describeRate, fitsWeight, formatWeight, getProduct, parseKg, quoteCart, readShopifyProducts, startCheckout, updateProduct } from "../src";
import { makeFixture } from "../evals/fixture";

const austin = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shopId = (await f.shop()).id;
  const mug = await createProduct(f.db, shopId, { title: "Mug", status: "active", variants: [{ title: "Default", priceMinor: 1500, stock: 40, weightGrams: 400 }] });
  const [mugVariant] = await f.variants(mug.id);
  const zone = await createShippingZone(f.db, shopId, { name: "United States", countries: ["US"] });
  const light = await addShippingRate(f.db, shopId, zone.id, { name: "Small parcel", priceMinor: 500, freeOverMinor: null, minDays: 3, maxDays: 5, maxWeightGrams: 2000 });
  const heavy = await addShippingRate(f.db, shopId, zone.id, { name: "Large parcel", priceMinor: 1500, freeOverMinor: null, minDays: 3, maxDays: 5, minWeightGrams: 2000, maxWeightGrams: 10000 });
  const quote = async (quantity: number, shippingRateId?: string) =>
    quoteCart(f.db, await f.shop(), [{ variantId: mugVariant!.id, quantity }], { country: "US", shippingRateId });
  return { ...f, shopId, mug, mugVariant: mugVariant!, zone, light, heavy, quote };
}

describe("shipping rates by weight", () => {
  it("offers only the rates the cart's weight fits, and charges the heavier rate for big orders", async () => {
    const f = await setup();
    const one = await f.quote(1);
    expect(one.weightGrams).toBe(400);
    expect(one.shipping!.rateId).toBe(f.light.id);
    expect(one.shippingMinor).toBe(500);
    // 2 kg exactly fits both; the cheaper one is used unless the buyer picks.
    expect((await f.quote(5)).shipping!.rateId).toBe(f.light.id);
    expect((await f.quote(5, f.heavy.id)).shipping!.rateId).toBe(f.heavy.id);
    const six = await f.quote(6, f.light.id);
    expect(six.weightGrams).toBe(2400);
    expect(six.shipping!.rateId).toBe(f.heavy.id);
    expect(six.shippingMinor).toBe(1500);
    // Over every limit there's nothing to ship with.
    await expect(f.quote(26)).rejects.toThrow("no shipping for an order this heavy (10.4 kg)");

    const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email: "buyer@example.com", address: austin, lines: [{ variantId: f.mugVariant.id, quantity: 6 }] });
    expect(order).toMatchObject({ shippingMinor: 1500, shippingMethod: "Large parcel" });
  });

  it("counts options without a weight as nothing", async () => {
    const f = await setup();
    const [lampVariant] = await f.variants(f.products.lamp.id);
    const q = await quoteCart(f.db, await f.shop(), [{ variantId: lampVariant!.id, quantity: 3 }, { variantId: f.mugVariant.id, quantity: 1 }], { country: "US" });
    expect(q.weightGrams).toBe(400);
    expect(q.shipping!.rateId).toBe(f.light.id);
  });

  it("keeps the weight when a product is edited, and reads Shopify's grams", async () => {
    const f = await setup();
    const product = await getProduct(f.db, f.shopId, f.mug.id);
    await updateProduct(f.db, f.shopId, f.mug.id, { title: "Mug", status: "active", variants: [{ id: product.variants[0]!.id, title: "Default", priceMinor: 1600 }] });
    expect((await getProduct(f.db, f.shopId, f.mug.id)).variants[0]!.weightGrams).toBe(400);
    await updateProduct(f.db, f.shopId, f.mug.id, { title: "Mug", status: "active", variants: [{ id: product.variants[0]!.id, title: "Default", priceMinor: 1600, weightGrams: null }] });
    expect((await getProduct(f.db, f.shopId, f.mug.id)).variants[0]!.weightGrams).toBeNull();

    const csv = "Handle,Title,Option1 Name,Option1 Value,Variant Price,Variant Grams\nmug,Mug,Title,Default Title,15.00,350\nbag,Bag,Title,Default Title,9.00,0\n";
    const { products } = readShopifyProducts(csv);
    expect(products.map((p) => p.variants[0]!.weightGrams)).toEqual([350, null]);
  });

  it("checks the limits and says them plainly", async () => {
    const f = await setup();
    await expect(addShippingRate(f.db, f.shopId, f.zone.id, { name: "Odd", priceMinor: 100, freeOverMinor: null, minDays: null, maxDays: null, minWeightGrams: 5000, maxWeightGrams: 2000 })).rejects.toThrow(
      "lightest weight has to be under the heaviest",
    );
    await expect(createProduct(f.db, f.shopId, { title: "Feather", variants: [{ priceMinor: 100, weightGrams: 0 }] })).rejects.toThrow("Leave the weight empty");
    const fromZero = await addShippingRate(f.db, f.shopId, f.zone.id, { name: "Any", priceMinor: 100, freeOverMinor: null, minDays: null, maxDays: null, minWeightGrams: 0, maxWeightGrams: null });
    expect(fromZero.minWeightGrams).toBeNull();
    expect(describeRate({ ...f.light, id: f.light.id }, "USD")).toBe("Small parcel (orders up to 2 kg): $5.00 (3–5 days)");
    expect(describeRate(f.heavy, "USD")).toBe("Large parcel (orders 2–10 kg): $15.00 (3–5 days)");
    expect(fitsWeight({ minWeightGrams: null, maxWeightGrams: null }, 99_000)).toBe(true);
    expect([formatWeight(750), formatWeight(1500)]).toEqual(["750 g", "1.5 kg"]);
    expect([parseKg(""), parseKg("1,25"), parseKg("abc")]).toEqual([null, 1250, Number.NaN]);
  });
});
