import { describe, expect, it } from "vitest";
import { createProduct, DemoModel, exportStore, setBlockedCountries, shipsToCountry, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const london = { name: "Ada Lovelace", line1: "10 Downing St", city: "London", postalCode: "SW1A 1AA", country: "GB" };
const austin = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("countries a product can't ship to", () => {
  it("stops checkout before payment, and only for the countries listed", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const knife = await createProduct(f.db, shopId, { title: "Chef's Knife", status: "active", variants: [{ title: "Default", priceMinor: 4500, stock: 9 }] });
    const [variant] = await f.variants(knife.id);
    expect(await setBlockedCountries(f.db, shopId, knife.id, ["gb", " IE ", "GB"])).toEqual(["GB", "IE"]);
    const checkout = async (address: typeof london | typeof austin) =>
      startCheckout(f.db, f.payments, await f.shop(), { email: "ada@example.com", address, lines: [{ variantId: variant!.id, quantity: 1 }], storefront: true });

    await expect(checkout(london)).rejects.toThrow("Chef's Knife can't be shipped to United Kingdom. Remove it from your cart to check out.");
    expect((await checkout(austin)).order.totalMinor).toBeGreaterThan(0);
    expect(shipsToCountry(["GB"], "GB")).toBe(false);
    expect(shipsToCountry(["GB"], "US")).toBe(true);
    expect(shipsToCountry(["GB"], null)).toBe(true);

    expect((await exportStore(f.db, shopId)).products.find((p) => p.title === "Chef's Knife")!.blocked_countries).toEqual(["GB", "IE"]);
    await expect(setBlockedCountries(f.db, shopId, knife.id, ["XX"])).rejects.toThrow("XX isn't a country the store can ship to.");
    expect(await setBlockedCountries(f.db, shopId, knife.id, [])).toEqual([]);
  });
});
