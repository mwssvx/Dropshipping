import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createCollection, DemoModel, exportStore, getCollectionByHandle, browseProducts, importStore, placeSoldOut, searchProducts, setSoldOutDisplay, storefrontCatalog } from "../src";
import { makeFixture } from "../evals/fixture";

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  const { lamp, stand, projector } = f.products;
  await f.db.update(schema.products).set({ status: "active" }).where(eq(schema.products.id, stand.id));
  // Nothing of the lamp is left.
  await f.db.update(schema.variants).set({ stock: 0 }).where(eq(schema.variants.productId, lamp.id));
  const ids = async (list: Promise<{ products: { id: string }[] }>) => (await list).products.map((p) => p.id);
  return { ...f, store: shop, lamp, stand, projector, ids };
}

describe("sold-out products in lists", () => {
  it("moves or hides products nobody can order, keeping the rest in order", () => {
    const items = [{ id: "a", out: true }, { id: "b", out: false }, { id: "c", out: true }, { id: "d", out: false }];
    const out = (i: { out: boolean }) => i.out;
    expect(placeSoldOut(items, "show", out).map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
    expect(placeSoldOut(items, "last", out).map((i) => i.id)).toEqual(["b", "d", "a", "c"]);
    expect(placeSoldOut(items, "hide", out).map((i) => i.id)).toEqual(["b", "d"]);
  });

  it("puts them last by default in search, collections and the home page, or hides them", async () => {
    const f = await setup();
    const shopId = f.store.id;
    expect(f.store.soldOutProducts).toBe("last");
    const featured = await f.ids(searchProducts(f.db, shopId, {}));
    expect(featured.at(-1)).toBe(f.lamp.id);
    expect(featured).toHaveLength(3);
    // Even when sorted by price, cheapest first.
    expect((await f.ids(searchProducts(f.db, shopId, { sort: "price_asc" }))).at(-1)).toBe(f.lamp.id);

    const collection = await createCollection(f.db, shopId, { title: "Lights", productIds: [f.lamp.id, f.projector.id] });
    const { products } = await getCollectionByHandle(f.db, shopId, collection.handle);
    expect(await f.ids(browseProducts(f.db, shopId, products, {}))).toEqual([f.projector.id, f.lamp.id]);
    let catalog = await storefrontCatalog(f.db, shopId);
    expect(catalog.collections.find((c) => c.id === collection.id)!.productIds).toEqual([f.projector.id, f.lamp.id]);
    expect(catalog.products.at(-1)).toMatchObject({ id: f.lamp.id, soldOut: true });

    await setSoldOutDisplay(f.db, shopId, "hide");
    expect(await f.ids(searchProducts(f.db, shopId, {}))).not.toContain(f.lamp.id);
    catalog = await storefrontCatalog(f.db, shopId);
    expect(catalog.collections.find((c) => c.id === collection.id)!.productIds).toEqual([f.projector.id]);
    expect(catalog.products.map((p) => p.id)).not.toContain(f.lamp.id);

    // Open for pre-order counts as available.
    const shipsBy = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    await f.db.update(schema.products).set({ preorder: { shipsBy, limit: null } }).where(eq(schema.products.id, f.lamp.id));
    expect(await f.ids(searchProducts(f.db, shopId, {}))).toContain(f.lamp.id);
    await f.db.update(schema.products).set({ preorder: null }).where(eq(schema.products.id, f.lamp.id));

    await setSoldOutDisplay(f.db, shopId, "show");
    expect(await f.ids(browseProducts(f.db, shopId, products, {}))).toEqual([f.lamp.id, f.projector.id]);
    await expect(setSoldOutDisplay(f.db, shopId, "bottom")).rejects.toThrow("Pick where sold-out products go.");
  });

  it("travels with the store export", async () => {
    const f = await setup();
    await setSoldOutDisplay(f.db, f.store.id, "hide");
    const data = await exportStore(f.db, f.store.id);
    expect(data.store.sold_out_products).toBe("hide");
    const g = await makeFixture(new DemoModel());
    const target = await g.shop();
    await g.db.delete(schema.products).where(eq(schema.products.shopId, target.id));
    await importStore(g.db, target.id, data);
    expect((await g.shop()).soldOutProducts).toBe("hide");
  });
});
