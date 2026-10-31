import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createProduct, createShop, DemoModel, listProducts, productPage, setRestockAlert, signUp, stockLevel, type ProductStockFilter } from "../src";
import { makeFixture } from "../evals/fixture";

describe("product list stock filter", () => {
  it("finds sold-out, running-low and in-stock products", async () => {
    const f = await makeFixture(new DemoModel());
    const user = await signUp(f.db, { email: "stock-filter@example.com", password: "correct horse" });
    const shop = await createShop(f.db, user.id, { name: "Stocked", country: "US" });
    const add = (title: string, stocks: (number | null)[]) =>
      createProduct(f.db, shop.id, { title, variants: stocks.map((stock, i) => ({ title: `O${i}`, priceMinor: 1000, stock })) });
    await add("Gone Mug", [0, 0]);
    await add("Half Gone Cap", [0, 12]);
    await add("Last Few Bag", [2]);
    await add("Plenty Tee", [40]);
    await add("Untracked Print", [null]);
    const titles = async (stock?: ProductStockFilter) => (await productPage(f.db, shop.id, { stock, sort: "title" })).products.map((p) => p.title);
    expect(await titles("sold_out")).toEqual(["Gone Mug"]);
    // The store's running-low number starts at 3; an option at 0 counts while others still sell.
    expect(await titles("low")).toEqual(["Half Gone Cap", "Last Few Bag"]);
    expect(await titles("in_stock")).toEqual(["Half Gone Cap", "Last Few Bag", "Plenty Tee", "Untracked Print"]);
    // One product at a time (the app's list) gives the same answer.
    const levels = async (at: number) => Object.fromEntries((await listProducts(f.db, shop.id)).map((p) => [p.title, stockLevel(p, at)]));
    expect(await levels(3)).toEqual({ "Gone Mug": "sold_out", "Half Gone Cap": "low", "Last Few Bag": "low", "Plenty Tee": null, "Untracked Print": null });
    expect((await levels(50))["Plenty Tee"]).toBe("low");
    await setRestockAlert(f.db, shop.id, 50);
    expect(await titles("low")).toEqual(["Half Gone Cap", "Last Few Bag", "Plenty Tee"]);
    // A product with no options isn't sold out, it just can't be bought.
    const bare = await add("Bare", [null]);
    await f.db.delete(schema.variants).where(eq(schema.variants.productId, bare.id));
    expect(await titles("sold_out")).toEqual(["Gone Mug"]);
    expect((await productPage(f.db, shop.id, { stock: "low", query: "bag" })).total).toBe(1);
  });
});
