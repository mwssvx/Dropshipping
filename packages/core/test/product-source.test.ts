import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createProduct, createShop, DemoModel, productPage, productsCsv, productSources, signUp, type ProductSource } from "../src";
import { makeFixture } from "../evals/fixture";

describe("product list source filter", () => {
  it("tells supplier products from the store's own, downloads and gift cards", async () => {
    const f = await makeFixture(new DemoModel());
    const user = await signUp(f.db, { email: "source@example.com", password: "correct horse" });
    const shop = await createShop(f.db, user.id, { name: "Sources", country: "US" });
    const add = async (title: string, set: Partial<typeof schema.products.$inferInsert> = {}) => {
      const p = await createProduct(f.db, shop.id, { title, variants: [{ priceMinor: 1000 }] });
      if (Object.keys(set).length) await f.db.update(schema.products).set(set).where(eq(schema.products.id, p.id));
    };
    await add("Linked Lamp", { sourceUrl: "https://supplier.example/lamp" });
    await add("Own Mug");
    await add("Own Cap");
    await add("Pattern PDF", { digital: true });
    await add("Gift Card", { giftCard: true, sourceUrl: null });
    const titles = async (source: ProductSource) => (await productPage(f.db, shop.id, { source, sort: "title" })).products.map((p) => p.title);
    expect(await titles("supplier")).toEqual(["Linked Lamp"]);
    expect(await titles("own")).toEqual(["Own Cap", "Own Mug"]);
    expect(await titles("digital")).toEqual(["Pattern PDF"]);
    expect(await titles("gift_card")).toEqual(["Gift Card"]);
    expect(await productSources(f.db, shop.id)).toEqual({ supplier: 1, own: 2, digital: 1, gift_card: 1 });
    expect((await productPage(f.db, shop.id, { source: "own", query: "mug" })).total).toBe(1);
    const csv = await productsCsv(f.db, shop.id, { source: "supplier" });
    expect(csv.trim().split("\n").slice(1).map((r) => r.split(",")[1])).toEqual(["Linked Lamp"]);
  });
});
