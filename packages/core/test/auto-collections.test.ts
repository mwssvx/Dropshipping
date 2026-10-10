import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  applyBulkEdit, applyRules, collectionsOfProduct, createCollection, createSale, createShop, createSizeChart, DemoModel, exportStore, getCollection,
  getCollectionByHandle, importStore, listCollections, listProducts, matchesRules, rulesFromForm, salesFor, signUp, sizeChartForProduct,
  storefrontCatalog, updateCollection, type CollectionRules,
} from "../src";
import { makeFixture } from "../evals/fixture";

const DAY = 86_400_000;

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  const { lamp, projector, stand } = f.products;
  return { ...f, shop, shopId: shop.id, lamp: lamp.id, projector: projector.id, stand: stand.id };
}

const rules = (conditions: CollectionRules["conditions"], more: Partial<CollectionRules> = {}): CollectionRules => ({ match: "all", sort: "newest", conditions, ...more });
const titles = (ps: { title: string }[]) => ps.map((p) => p.title);

describe("automatic collections", () => {
  it("checks the rules as the merchant types them", () => {
    const form = (conditions: Record<string, string>[], extra = {}) => JSON.stringify({ match: "all", sort: "newest", conditions, ...extra });
    expect(() => rulesFromForm(form([]))).toThrow("Add at least one condition.");
    expect(() => rulesFromForm("nonsense")).toThrow("Add at least one condition.");
    expect(() => rulesFromForm(form([{ kind: "price_at_most", price: "cheap" }]))).toThrow("Condition 1: enter a price like 30.00.");
    expect(() => rulesFromForm(form([{ kind: "in_stock" }, { kind: "title_contains", text: " " }]))).toThrow("Condition 2: enter the word the title should contain.");
    expect(() => rulesFromForm(form([{ kind: "added_within_days", days: "0" }]))).toThrow("Condition 1: use at least 1 day.");
    expect(() => rulesFromForm(form([{ kind: "option_is", name: "Color", value: "" }]))).toThrow("Condition 1: enter the option's value");
    expect(rulesFromForm(form([{ kind: "price_at_most", price: "30" }, { kind: "option_is", name: " Color ", value: "Red" }], { match: "any", sort: "price_asc" }))).toEqual({
      match: "any",
      sort: "price_asc",
      conditions: [{ kind: "price_at_most", minor: 3000 }, { kind: "option_is", name: "Color", value: "Red" }],
    });
  });

  it("matches on title, price, sale, stock, age and options, with every or any condition", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    const mug = { title: "Red Coffee Mug", createdAt: new Date(now.getTime() - 3 * DAY), variants: [{ priceMinor: 1200, compareAtMinor: 1500, stock: 0, options: { Color: "Red" } }, { priceMinor: 900, compareAtMinor: null, stock: 4, options: { Color: "Blue" } }] };
    const lamp = { title: "Desk Lamp", createdAt: new Date(now.getTime() - 60 * DAY), variants: [{ priceMinor: 4000, compareAtMinor: null, stock: 0, options: {} }] };
    const check = (c: CollectionRules["conditions"][number]) => [matchesRules(mug, rules([c]), now), matchesRules(lamp, rules([c]), now)];
    expect(check({ kind: "title_contains", text: "MUG" })).toEqual([true, false]);
    // A product's price is its lowest option's.
    expect(check({ kind: "price_at_most", minor: 900 })).toEqual([true, false]);
    expect(check({ kind: "price_at_least", minor: 1000 })).toEqual([false, true]);
    expect(check({ kind: "on_sale" })).toEqual([true, false]);
    expect(check({ kind: "in_stock" })).toEqual([true, false]);
    expect(check({ kind: "added_within_days", days: 30 })).toEqual([true, false]);
    expect(check({ kind: "option_is", name: "color", value: "blue" })).toEqual([true, false]);
    expect(matchesRules(lamp, rules([{ kind: "in_stock" }, { kind: "price_at_least", minor: 1000 }]), now)).toBe(false);
    expect(matchesRules(lamp, rules([{ kind: "in_stock" }, { kind: "price_at_least", minor: 1000 }], { match: "any" }), now)).toBe(true);
    expect(titles(applyRules([lamp, mug], rules([{ kind: "price_at_least", minor: 0 }], { sort: "price_asc" }), now))).toEqual(["Red Coffee Mug", "Desk Lamp"]);
    expect(titles(applyRules([mug, lamp], rules([{ kind: "price_at_least", minor: 0 }], { sort: "title" }), now))).toEqual(["Desk Lamp", "Red Coffee Mug"]);
  });

  it("fills itself from the store's products and keeps up as they change", async () => {
    const f = await setup();
    // Hand-picked products are dropped once rules are set.
    const cheap = await createCollection(f.db, f.shopId, { title: "Under $14.50", productIds: [f.projector], rules: rules([{ kind: "price_at_most", minor: 1450 }], { sort: "price_asc" }) });
    expect((await getCollection(f.db, f.shopId, cheap.id)).productIds).toEqual([]);
    expect(titles((await getCollectionByHandle(f.db, f.shopId, cheap.handle)).products)).toEqual(["Sunset Projection Lamp"]);

    // The projector's price drops, so it joins, cheapest first. A draft never shows.
    const [small] = await f.db.select().from(schema.variants).where(eq(schema.variants.productId, f.projector));
    await f.db.update(schema.variants).set({ priceMinor: 1299 }).where(eq(schema.variants.id, small!.id));
    await f.db.update(schema.variants).set({ priceMinor: 999 }).where(eq(schema.variants.productId, f.stand));
    expect(titles((await getCollectionByHandle(f.db, f.shopId, cheap.handle)).products)).toEqual(["Galaxy Projector", "Sunset Projection Lamp"]);
    expect((await listCollections(f.db, f.shopId)).find((c) => c.id === cheap.id)?.productCount).toBe(2);
    expect((await storefrontCatalog(f.db, f.shopId)).collections.find((c) => c.id === cheap.id)?.productIds).toEqual([f.projector, f.lamp]);
    expect(await collectionsOfProduct(f.db, f.shopId, f.lamp)).toEqual([cheap.id]);

    // Sold out leaves an "in stock" collection.
    const inStock = await createCollection(f.db, f.shopId, { title: "Ready to ship", rules: rules([{ kind: "in_stock" }, { kind: "option_is", name: "Size", value: "Large" }]) });
    expect(titles((await getCollectionByHandle(f.db, f.shopId, inStock.handle)).products).sort()).toEqual(["Galaxy Projector", "Sunset Projection Lamp"]);
    await f.db.update(schema.variants).set({ stock: 0 }).where(eq(schema.variants.productId, f.projector));
    expect(titles((await getCollectionByHandle(f.db, f.shopId, inStock.handle)).products)).toEqual(["Sunset Projection Lamp"]);

    // Back to picking by hand.
    await updateCollection(f.db, f.shopId, inStock.id, { title: "Ready to ship", productIds: [f.projector] });
    expect(titles((await getCollectionByHandle(f.db, f.shopId, inStock.handle)).products)).toEqual(["Galaxy Projector"]);
    expect((await getCollection(f.db, f.shopId, inStock.id)).rules).toBeNull();
  });

  it("works for sales and size charts, and can't be bulk edited", async () => {
    const f = await setup();
    const big = await createCollection(f.db, f.shopId, { title: "Big ones", rules: rules([{ kind: "title_contains", text: "projector" }]) });
    await createSale(f.db, f.shopId, { title: "Projector week", percentOff: 25, scope: "collection", collectionId: big.id, startsAt: new Date() });
    const sales = await salesFor(f.db, f.shopId, [f.lamp, f.projector]);
    expect(sales.get(f.projector)).toMatchObject({ percentOff: 25 });
    expect(sales.has(f.lamp)).toBe(false);

    await createSizeChart(f.db, f.shopId, { name: "Projectors", unit: "cm", columns: ["Size", "Width"], rows: [["Small", "10"]], collectionIds: [big.id] });
    expect((await sizeChartForProduct(f.db, f.shopId, f.projector))?.name).toBe("Projectors");
    expect(await sizeChartForProduct(f.db, f.shopId, f.lamp)).toBeNull();

    await expect(applyBulkEdit(f.db, f.shop, [f.lamp], { kind: "collection", collectionId: big.id })).rejects.toThrow('"Big ones" fills itself by its rules.');
  });

  it("keeps its rules in the store file", async () => {
    const f = await setup();
    await createCollection(f.db, f.shopId, { title: "New in", rules: rules([{ kind: "added_within_days", days: 14 }], { sort: "title" }) });
    const file = JSON.parse(JSON.stringify(await exportStore(f.db, f.shopId)));
    expect(file.collections[0]).toMatchObject({ handle: "new-in", products: [], rules: { match: "all", sort: "title", conditions: [{ kind: "added_within_days", days: 14 }] } });
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, file);
    const copied = await getCollectionByHandle(f.db, copy.id, "new-in");
    expect(copied.collection).toMatchObject({ title: "New in", rules: { sort: "title" } });
    // The copied products are new, so they're in.
    expect(titles(copied.products)).toEqual(titles(await listProducts(f.db, copy.id)).filter((t) => !t.includes("Phone Stand")).sort());
  });
});
