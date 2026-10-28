import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { compactProducts, createProduct, createShop, DemoModel, listActiveProducts, quickAddVariant, setCardQuickAdd, signUp, storefrontCatalog } from "../src";
import { makeFixture } from "../evals/fixture";

describe("add to cart from product cards", () => {
  it("is offered only when there's nothing to choose or type, and some left", () => {
    const one = (stock: number | null) => [{ id: "v1", stock }];
    expect(quickAddVariant({ variants: one(5) })).toBe("v1");
    expect(quickAddVariant({ variants: one(null) })).toBe("v1");
    expect(quickAddVariant({ variants: one(0) })).toBeNull();
    expect(quickAddVariant({ variants: [] })).toBeNull();
    expect(quickAddVariant({ variants: [{ id: "a", stock: 5 }, { id: "b", stock: 5 }] })).toBeNull();
    expect(quickAddVariant({ variants: one(5), personalization: [{ id: "n" }] })).toBeNull();
    expect(quickAddVariant({ variants: one(5), purchaseLimit: { min: 2 } })).toBeNull();
    expect(quickAddVariant({ variants: one(5), purchaseLimit: { min: 1 } })).toBe("v1");
  });

  it("reaches the store's cards, and the merchant can turn it off", async () => {
    const f = await makeFixture(new DemoModel());
    const user = await signUp(f.db, { email: "quick-add@example.com", password: "correct horse" });
    const shop = await createShop(f.db, user.id, { name: "Quick", country: "US" });
    const add = async (title: string, stocks: (number | null)[]) => {
      const p = await createProduct(f.db, shop.id, { title, variants: stocks.map((stock, i) => ({ title: `O${i}`, priceMinor: 1000, stock })) });
      await f.db.update(schema.products).set({ status: "active" }).where(eq(schema.products.id, p.id));
      return p;
    };
    const mug = await add("Mug", [8]);
    await add("Tee", [4, 4]);
    await add("Gone", [0]);
    const [mugOption] = await f.variants(mug.id);
    const quick = (list: { title: string; quickAdd: string | null }[]) => Object.fromEntries(list.map((p) => [p.title, p.quickAdd]));
    expect(quick((await storefrontCatalog(f.db, shop.id)).products)).toEqual({ Mug: mugOption!.id, Tee: null, Gone: null });
    expect(quick(compactProducts(await listActiveProducts(f.db, shop.id)))).toEqual({ Mug: mugOption!.id, Tee: null, Gone: null });

    const fresh = await f.db.query.shops.findFirst({ where: eq(schema.shops.id, shop.id) });
    expect(fresh!.cardQuickAdd).toBe(true);
    await setCardQuickAdd(f.db, shop.id, false);
    expect((await f.db.query.shops.findFirst({ where: eq(schema.shops.id, shop.id) }))!.cardQuickAdd).toBe(false);
  });
});
