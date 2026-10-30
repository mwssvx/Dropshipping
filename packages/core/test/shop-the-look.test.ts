import { describe, expect, it } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, LOOK_MAX, lookVariants, parseTheme, defaultTheme, SECTION_TYPES, sectionDefaults } from "../src";
import { makeFixture } from "../evals/fixture";

describe("shop the look", () => {
  it("is a home page section that holds a few hand-picked products", () => {
    expect(SECTION_TYPES).toContain("shop_the_look");
    expect(sectionDefaults("shop_the_look")).toMatchObject({ heading: "", text: "", productIds: [] });
    const ids = Array.from({ length: LOOK_MAX + 1 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);
    const doc = defaultTheme("Shop");
    const look = (productIds: string[]) => ({ ...doc, home: [{ id: "look0001", type: "shop_the_look", hidden: false, settings: { heading: "", text: "", imageUrl: "", productIds } }] });
    expect(parseTheme(look(ids.slice(0, LOOK_MAX))).home[0]).toMatchObject({ settings: { productIds: ids.slice(0, LOOK_MAX) } });
    expect(() => parseTheme(look(ids))).toThrow(`up to ${LOOK_MAX} products`);
  });

  it("only adds pieces a card could add straight away", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const { lamp, projector, stand } = f.products;
    const [lampV] = await f.variants(lamp.id);
    const [projV] = await f.variants(projector.id);
    const [standV] = await f.variants(stand.id);
    for (const [p, v] of [[lamp.id, lampV!.id], [projector.id, projV!.id]] as const)
      await f.db.delete(schema.variants).where(and(eq(schema.variants.productId, p), ne(schema.variants.id, v)));

    // Repeats and junk are dropped; the draft stand stays out.
    expect(await lookVariants(f.db, shopId, [projV!.id, lampV!.id, projV!.id, "junk", standV!.id])).toEqual([projV!.id, lampV!.id]);
    expect(await lookVariants(f.db, "00000000-0000-4000-8000-000000000000", [lampV!.id])).toEqual([]);
    expect(await lookVariants(f.db, shopId, [])).toEqual([]);

    // Sold out, personalised, or with options to pick: added from the product's own page instead.
    await f.db.update(schema.variants).set({ stock: 0 }).where(eq(schema.variants.id, projV!.id));
    expect(await lookVariants(f.db, shopId, [lampV!.id, projV!.id])).toEqual([lampV!.id]);
    await f.db.update(schema.variants).set({ stock: null }).where(eq(schema.variants.id, projV!.id));
    await f.db.update(schema.products).set({ personalization: [{ id: "name", label: "Name", required: true, maxLength: 20 }] as never }).where(eq(schema.products.id, projector.id));
    expect(await lookVariants(f.db, shopId, [lampV!.id, projV!.id])).toEqual([lampV!.id]);
    const { id: _id, ...copy } = lampV!;
    await f.db.insert(schema.variants).values({ ...copy, title: "Blue", sku: null, position: 2 });
    expect(await lookVariants(f.db, shopId, [lampV!.id, projV!.id])).toEqual([]);
  });
});
