import { describe, expect, it } from "vitest";
import { createCollection, createProduct, createShop, DemoModel, parseProductQuery, productIds, productPage, productsCsv, signUp, viewQuery } from "../src";
import { makeFixture } from "../evals/fixture";

describe("product list by collection", () => {
  it("shows only the products a hand-picked collection holds", async () => {
    const f = await makeFixture(new DemoModel());
    const user = await signUp(f.db, { email: "in-collection@example.com", password: "correct horse" });
    const shop = await createShop(f.db, user.id, { name: "Grouped", country: "US" });
    const add = (title: string) => createProduct(f.db, shop.id, { title, variants: [{ title: "Default", priceMinor: 1000 }] });
    const mug = await add("Mug");
    const cap = await add("Cap");
    await add("Tee");
    const gifts = await createCollection(f.db, shop.id, { title: "Gifts", productIds: [mug.id, cap.id] });
    // Another store's collection never leaks in.
    const other = await createShop(f.db, user.id, { name: "Other grouped", country: "US" });
    const theirs = await createCollection(f.db, other.id, { title: "Theirs", productIds: [] });

    const titles = async (collection?: string, query?: string) => (await productPage(f.db, shop.id, { collection, query, sort: "title" })).products.map((p) => p.title);
    expect(await titles(gifts.id)).toEqual(["Cap", "Mug"]);
    expect(await titles(gifts.id, "mug")).toEqual(["Mug"]);
    expect(await titles(theirs.id)).toEqual([]);
    expect(await titles()).toEqual(["Cap", "Mug", "Tee"]);
    expect((await productIds(f.db, shop.id, { collection: gifts.id }, 10)).sort()).toEqual([mug.id, cap.id].sort());
    const csv = await productsCsv(f.db, shop.id, { collection: gifts.id });
    expect(csv).toContain("Mug");
    expect(csv).not.toContain("Tee");

    const read = (q: Record<string, string>) => parseProductQuery((k) => q[k]);
    expect(read({ collection: gifts.id }).collection).toBe(gifts.id);
    expect(read({ collection: "not-an-id" }).collection).toBeUndefined();
    expect(viewQuery("products", { collection: gifts.id, stock: "low" })).toBe(`stock=low&collection=${gifts.id}`);
  });
});
