import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createProduct, createShop, DemoModel, productPage, signUp, updateProduct, type ProductSort } from "../src";
import { makeFixture } from "../evals/fixture";

describe("product list sort", () => {
  it("orders by date, title, last change and lowest price", async () => {
    const f = await makeFixture(new DemoModel());
    const user = await signUp(f.db, { email: "sort@example.com", password: "correct horse" });
    const shop = await createShop(f.db, user.id, { name: "Sorted", country: "US" });
    const at = (n: number) => new Date(Date.UTC(2026, 0, n));
    const add = async (title: string, prices: number[], day: number) => {
      const p = await createProduct(f.db, shop.id, { title, variants: prices.map((priceMinor, i) => ({ title: `O${i}`, priceMinor })) });
      await f.db.update(schema.products).set({ createdAt: at(day), updatedAt: at(day) }).where(eq(schema.products.id, p.id));
      return p;
    };
    await add("banana bag", [3000], 1);
    const apple = await add("Apple Mug", [1500, 900], 2);
    await add("Cherry Cap", [2000], 3);
    const titles = async (sort?: ProductSort) =>
      (await productPage(f.db, shop.id, { sort })).products.map((p) => p.title);
    expect(await titles()).toEqual(["Cherry Cap", "Apple Mug", "banana bag"]);
    expect(await titles("oldest")).toEqual(["banana bag", "Apple Mug", "Cherry Cap"]);
    // Case doesn't matter for titles.
    expect(await titles("title")).toEqual(["Apple Mug", "banana bag", "Cherry Cap"]);
    expect(await titles("title_desc")).toEqual(["Cherry Cap", "banana bag", "Apple Mug"]);
    // The mug's cheapest option is 9.00.
    expect(await titles("price")).toEqual(["Apple Mug", "Cherry Cap", "banana bag"]);
    expect(await titles("price_desc")).toEqual(["banana bag", "Cherry Cap", "Apple Mug"]);
    await updateProduct(f.db, shop.id, apple.id, { title: "Apple Mug", variants: [{ title: "O0", priceMinor: 1500 }] });
    expect((await titles("updated"))[0]).toBe("Apple Mug");
    expect((await productPage(f.db, shop.id, { sort: "price", size: 2, page: 2 })).products.map((p) => p.title)).toEqual(["banana bag"]);
  });
});
