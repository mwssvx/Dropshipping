import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createGiftCardProduct, createProduct, DemoModel, listProducts, productChoices, sampleProduct } from "../src";
import { makeFixture } from "../evals/fixture";

describe("product pickers", () => {
  it("lists every product lightly, in the same order as the full list", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const choices = await productChoices(f.db, shopId);
    const full = await listProducts(f.db, shopId);
    expect(choices.map((c) => c.id)).toEqual(full.map((p) => p.id));
    expect(Object.keys(choices[0]!).sort()).toEqual(["giftCard", "handle", "id", "status", "title"]);
  });

  it("picks the newest product on sale as an example, never a draft or a gift card", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const mug = await createProduct(f.db, shop.id, { title: "Mug", status: "active", variants: [{ title: "Default", priceMinor: 1500 }] });
    await createProduct(f.db, shop.id, { title: "Draft mug", status: "draft", variants: [{ title: "Default", priceMinor: 1500 }] });
    await createGiftCardProduct(f.db, shop, [2500]);
    const sample = await sampleProduct(f.db, shop.id);
    expect(sample).toMatchObject({ id: mug.id, title: "Mug" });
    expect(sample!.variants.map((v) => v.priceMinor)).toEqual([1500]);

    await f.db.update(schema.products).set({ status: "draft" }).where(eq(schema.products.shopId, shop.id));
    expect(await sampleProduct(f.db, shop.id)).toBeNull();
  });
});
