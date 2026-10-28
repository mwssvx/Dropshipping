import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  applyRules, createProduct, createShop, DemoModel, describeCondition, exportStore, getProduct, importStore, productPage, productTags, readShopifyProducts, rulesFromForm, signUp, updateProduct,
} from "../src";
import { makeFixture } from "../evals/fixture";

const variants = [{ priceMinor: 1500 }];

describe("product tags", () => {
  it("are cleaned, kept when a save leaves them out, and limited", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const p = await createProduct(f.db, shopId, { title: "Straw Hat", variants, tags: "Summer,  Gift   Idea , summer" });
    expect(p.tags).toEqual(["summer", "gift idea"]);
    // The API or an older form that sends no tags leaves them be.
    await updateProduct(f.db, shopId, p.id, { title: "Straw Sun Hat", variants });
    expect((await getProduct(f.db, shopId, p.id)).tags).toEqual(["summer", "gift idea"]);
    await updateProduct(f.db, shopId, p.id, { title: "Straw Sun Hat", variants, tags: ["beach"] });
    expect((await getProduct(f.db, shopId, p.id)).tags).toEqual(["beach"]);
    await updateProduct(f.db, shopId, p.id, { title: "Straw Sun Hat", variants, tags: "" });
    expect((await getProduct(f.db, shopId, p.id)).tags).toEqual([]);
    await expect(createProduct(f.db, shopId, { title: "Many", variants, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).rejects.toThrow("up to 20 tags");
    await expect(createProduct(f.db, shopId, { title: "Long", variants, tags: "x".repeat(31) })).rejects.toThrow("30 characters");
  });

  it("filter the product list and are counted", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    await createProduct(f.db, shopId, { title: "Straw Hat", variants, tags: "summer, hats" });
    await createProduct(f.db, shopId, { title: "Sun Cream", variants, tags: "summer" });
    await createProduct(f.db, shopId, { title: "Wool Scarf", variants, tags: "winter" });
    expect((await productPage(f.db, shopId, { tag: "Summer" })).products.map((p) => p.title).sort()).toEqual(["Straw Hat", "Sun Cream"]);
    expect((await productPage(f.db, shopId, { tag: "summer", query: "hat" })).total).toBe(1);
    expect((await productPage(f.db, shopId, { tag: "nothing" })).total).toBe(0);
    expect(await productTags(f.db, shopId)).toEqual([
      { tag: "summer", count: 2 },
      { tag: "hats", count: 1 },
      { tag: "winter", count: 1 },
    ]);
  });

  it("fill a collection by rule", () => {
    const rules = rulesFromForm(JSON.stringify({ match: "all", sort: "title", conditions: [{ kind: "tagged", tag: " Summer " }] }));
    expect(rules.conditions).toEqual([{ kind: "tagged", tag: "summer" }]);
    expect(describeCondition(rules.conditions[0]!, String)).toBe('Tagged "summer"');
    const product = (title: string, tags?: string[]) => ({ title, tags, createdAt: new Date(), variants: [{ priceMinor: 100, compareAtMinor: null, stock: null }] });
    expect(applyRules([product("Hat", ["summer"]), product("Scarf", ["winter"]), product("Old")], rules).map((p) => p.title)).toEqual(["Hat"]);
    expect(() => rulesFromForm(JSON.stringify({ conditions: [{ kind: "tagged", tag: " " }] }))).toThrow("Condition 1: enter the tag");
  });

  it("travel in store files and come over from Shopify", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    await createProduct(f.db, shopId, { title: "Straw Hat", variants, tags: "summer, gift idea" });
    const file = await exportStore(f.db, shopId);
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, file);
    const copied = await f.db.query.products.findMany({ where: eq(schema.products.shopId, copy.id), columns: { title: true, tags: true } });
    expect(copied.find((p) => p.title === "Straw Hat")?.tags).toEqual(["summer", "gift idea"]);
    expect(copied.filter((p) => p.title !== "Straw Hat").every((p) => p.tags.length === 0)).toBe(true);

    const csv = "Handle,Title,Tags,Variant Price\nsun-hat,Sun Hat,\"Summer, Beach  Wear,summer\",12.00\n";
    expect(readShopifyProducts(csv).products[0]!.tags).toEqual(["summer", "beach wear"]);
  });
});
