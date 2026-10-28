import { describe, expect, it } from "vitest";
import { createProduct, createShop, DemoModel, parseProductQuery, productIds, signUp } from "../src";
import { makeFixture } from "../evals/fixture";

describe("every product in a list", () => {
  it("reads the list from a link and finds its products past the first page", async () => {
    expect(parseProductQuery((k) => ({ q: " mug ", status: "draft", tag: " Kitchen", stock: "nope", source: "own" })[k])).toEqual({
      query: "mug", status: "draft", tag: "kitchen", stock: undefined, source: "own",
    });
    const f = await makeFixture(new DemoModel());
    const user = await signUp(f.db, { email: "all@example.com", password: "correct horse" });
    const shop = await createShop(f.db, user.id, { name: "All of them", country: "US" });
    for (let i = 0; i < 4; i++) await createProduct(f.db, shop.id, { title: `Mug ${i}`, variants: [{ priceMinor: 1000 }] });
    await createProduct(f.db, shop.id, { title: "Cap", variants: [{ priceMinor: 1000 }] });
    expect(await productIds(f.db, shop.id, { query: "mug" }, 10)).toHaveLength(4);
    expect(await productIds(f.db, shop.id, {}, 3)).toHaveLength(3);
  });
});
