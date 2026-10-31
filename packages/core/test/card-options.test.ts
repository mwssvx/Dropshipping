import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { compactProducts, createProduct, createShop, DemoModel, listActiveProducts, QUICK_PICK_MAX, quickPickOptions, signUp, storefrontCatalog } from "../src";
import { makeFixture } from "../evals/fixture";

const v = (id: string, stock: number | null, priceMinor = 1000) => ({ id, title: id.toUpperCase(), priceMinor, stock });

describe("picking an option on a product card", () => {
  it("lists a few options at one price, with sold out ones that can't be picked", () => {
    expect(quickPickOptions({ variants: [v("s", 3), v("m", 0), v("l", null)] })).toEqual([
      { id: "s", title: "S", soldOut: false },
      { id: "m", title: "M", soldOut: true },
      { id: "l", title: "L", soldOut: false },
    ]);
    // One option is the plain "Add to cart"; none left, different prices, typing, a minimum or too many go to the page.
    expect(quickPickOptions({ variants: [v("s", 3)] })).toBeNull();
    expect(quickPickOptions({ variants: [v("s", 0), v("m", 0)] })).toBeNull();
    expect(quickPickOptions({ variants: [v("s", 3), v("m", 3, 1200)] })).toBeNull();
    expect(quickPickOptions({ variants: [v("s", 3), v("m", 3)], personalization: [{ id: "name" }] })).toBeNull();
    expect(quickPickOptions({ variants: [v("s", 3), v("m", 3)], purchaseLimit: { min: 2 } })).toBeNull();
    const many = Array.from({ length: QUICK_PICK_MAX + 1 }, (_, i) => v(`o${i}`, 1));
    expect(quickPickOptions({ variants: many })).toBeNull();
    expect(quickPickOptions({ variants: many.slice(0, QUICK_PICK_MAX) })).toHaveLength(QUICK_PICK_MAX);
  });

  it("reaches the store's cards", async () => {
    const f = await makeFixture(new DemoModel());
    const user = await signUp(f.db, { email: "card-options@example.com", password: "correct horse" });
    const shop = await createShop(f.db, user.id, { name: "Picks", country: "US" });
    const add = async (title: string, prices: number[]) => {
      const p = await createProduct(f.db, shop.id, { title, variants: prices.map((priceMinor, i) => ({ title: `Size ${i + 1}`, priceMinor, stock: 5 })) });
      await f.db.update(schema.products).set({ status: "active" }).where(eq(schema.products.id, p.id));
    };
    await add("Tee", [1000, 1000]);
    await add("Frame", [1000, 2000]);
    await add("Mug", [800]);
    const picks = (list: { title: string; quickPick: { title: string }[] | null }[]) => Object.fromEntries(list.map((p) => [p.title, p.quickPick?.map((o) => o.title) ?? null]));
    const expected = { Tee: ["Size 1", "Size 2"], Frame: null, Mug: null };
    expect(picks((await storefrontCatalog(f.db, shop.id)).products)).toEqual(expected);
    expect(picks(compactProducts(await listActiveProducts(f.db, shop.id)))).toEqual(expected);
  });
});
