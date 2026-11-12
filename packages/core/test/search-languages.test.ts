import { describe, expect, it } from "vitest";
import { DemoModel, listActiveProducts, saveTranslation, searchProducts, setShopLanguages } from "../src";
import { makeFixture } from "../evals/fixture";

describe("store search in the shopper's language", () => {
  it("finds products by their translated title and description, and still by the original", async () => {
    const f = await makeFixture(new DemoModel());
    await setShopLanguages(f.db, (await f.shop()).id, ["de"]);
    const shop = await f.shop();
    const lamp = (await listActiveProducts(f.db, shop.id)).find((p) => p.title === "Sunset Projection Lamp")!;
    await saveTranslation(f.db, shop, { language: "de", kind: "product", refId: lamp.id, fields: { title: "Sonnenuntergangslampe", description: "Warmes Licht für gemütliche Abende" } });
    const titles = async (q: string, language?: string | null) => (await searchProducts(f.db, shop.id, { q, language })).products.map((p) => p.title);

    expect(await titles("sonnenuntergangslampe", "de")).toEqual(["Sunset Projection Lamp"]);
    expect(await titles("gemütliche", "de")).toEqual(["Sunset Projection Lamp"]);
    expect(await titles("gemutliche abende", "de")).toEqual(["Sunset Projection Lamp"]); // accents don't matter
    expect(await titles("lamp", "de")).toEqual(["Sunset Projection Lamp"]); // the original words still work
    // Other languages, and English, don't see the German words.
    expect(await titles("sonnenuntergangslampe")).toEqual([]);
    expect(await titles("sonnenuntergangslampe", "fr")).toEqual([]);
  });
});
