import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  createCollection,
  createPage,
  createShop,
  deletePage,
  DemoModel,
  exportStore,
  getPublishedTheme,
  getTranslation,
  importStore,
  localizeCollections,
  localizedTheme,
  localizePage,
  localizeProducts,
  saveTranslation,
  setShopLanguages,
  signUp,
  themeStrings,
  translateStoreWithAi,
  translationList,
  translationSummary,
} from "../src";
import { makeFixture } from "../evals/fixture";

async function setup() {
  const f = await makeFixture(new DemoModel());
  await setShopLanguages(f.db, (await f.shop()).id, ["fr", "de"]);
  const shop = await f.shop();
  return { ...f, shop };
}

describe("store languages", () => {
  it("keeps only the languages we offer, in a stable order", async () => {
    const f = await setup();
    expect(f.shop.languages).toEqual(["de", "fr"]);
    await expect(setShopLanguages(f.db, f.shop.id, ["de", "xx"])).rejects.toThrow("Pick from the languages listed.");
    await expect(translationList(f.db, f.shop, "es")).rejects.toThrow();
  });

  it("the merchant translates a product, page, collection and the theme, and the store shows them", async () => {
    const f = await setup();
    const { lamp, projector } = f.products;
    const page = await createPage(f.db, f.shop.id, { title: "Shipping", body: "We ship worldwide.\n\nMost orders arrive in a week." });
    const collection = await createCollection(f.db, f.shop.id, { title: "Lamps", description: "Soft light for every room." });

    await saveTranslation(f.db, f.shop, { language: "de", kind: "product", refId: lamp.id, fields: { title: "Sonnenuntergangslampe", description: "" } });
    await saveTranslation(f.db, f.shop, { language: "de", kind: "page", refId: page.id, fields: { title: "Versand", body: "Wir versenden weltweit." } });
    await saveTranslation(f.db, f.shop, { language: "de", kind: "collection", refId: collection.id, fields: { title: "Lampen" } });

    const products = await localizeProducts(f.db, f.shop.id, "de", [
      { id: lamp.id, title: "Sunset Projection Lamp", descriptionHtml: "Original" },
      { id: projector.id, title: "Galaxy Projector" },
    ]);
    // An empty field falls back to the original; untranslated products stay as they are.
    expect(products).toEqual([
      { id: lamp.id, title: "Sonnenuntergangslampe", descriptionHtml: "Original" },
      { id: projector.id, title: "Galaxy Projector" },
    ]);
    expect(await localizeProducts(f.db, f.shop.id, "fr", products.slice(1))).toEqual(products.slice(1));
    expect(await localizeProducts(f.db, f.shop.id, null, [{ id: lamp.id, title: "x" }])).toEqual([{ id: lamp.id, title: "x" }]);
    expect((await localizePage(f.db, f.shop.id, "de", page)).body).toBe("Wir versenden weltweit.");
    expect((await localizeCollections(f.db, f.shop.id, "de", [collection]))[0]).toMatchObject({ title: "Lampen", description: "Soft light for every room." });

    // Theme text is translated by its original wording, so moving sections around keeps it.
    const strings = themeStrings(await getPublishedTheme(f.db, f.shop));
    expect(strings.length).toBeGreaterThan(2);
    const first = strings[0]!;
    await saveTranslation(f.db, f.shop, { language: "de", kind: "theme", refId: f.shop.id, fields: { [first]: "Übersetzt" } });
    const doc = await localizedTheme(f.db, f.shop, "de");
    expect(themeStrings(doc)).toContain("Übersetzt");
    expect(themeStrings(doc)).not.toContain(first);
    expect(await localizedTheme(f.db, f.shop, null)).toEqual(await getPublishedTheme(f.db, f.shop));

    await expect(saveTranslation(f.db, f.shop, { language: "de", kind: "page", refId: page.id, fields: { title: "<b>Versand</b>" } })).rejects.toThrow("plain text");
    await expect(getTranslation(f.db, f.shop, "de", "product", "00000000-0000-0000-0000-000000000000")).rejects.toThrow();

    // Clearing every field removes the translation; deleting a page removes its translations.
    expect(await saveTranslation(f.db, f.shop, { language: "de", kind: "collection", refId: collection.id, fields: { title: " " } })).toMatchObject({ removed: true });
    await deletePage(f.db, f.shop.id, page.id);
    expect(await f.db.query.translations.findMany({ where: eq(schema.translations.kind, "page") })).toEqual([]);
  });

  it("marks translations out of date when the original changes, and the AI translator fills in the rest", async () => {
    const f = await setup();
    const { lamp } = f.products;
    await saveTranslation(f.db, f.shop, { language: "de", kind: "product", refId: lamp.id, fields: { title: "Lampe", description: "Eine Lampe." } });
    const status = async () => Object.fromEntries((await translationList(f.db, f.shop, "de")).map((i) => [i.refId, i.status]));
    expect((await status())[lamp.id]).toBe("done");
    await f.db.update(schema.products).set({ title: "Sunset Lamp" }).where(eq(schema.products.id, lamp.id));
    expect((await status())[lamp.id]).toBe("outdated");

    const before = await translationSummary(f.db, f.shop);
    expect(before.map((s) => s.language)).toEqual(["de", "fr"]);
    const de = before[0]!;
    expect(de.done + de.outdated + de.missing).toBe(de.total);
    expect(de.missing).toBeGreaterThan(0);

    // The demo brain marks each text with the language; a real model translates it.
    let left = Infinity;
    for (let i = 0; i < 5 && left > 0; i++) {
      const r = await translateStoreWithAi(f.ctx, f.shop, "de", { batch: 2 });
      expect(r.status).toBe("done");
      left = r.left;
    }
    expect(left).toBe(0);
    const after = (await translationSummary(f.db, f.shop))[0]!;
    expect(after).toMatchObject({ done: after.total, outdated: 0, missing: 0 });
    const lampDe = await getTranslation(f.db, f.shop, "de", "product", lamp.id);
    expect(lampDe).toMatchObject({ status: "done", byAi: true });
    expect(lampDe.fields.title).toBe("[DE] Sunset Lamp");
    const theme = await getTranslation(f.db, f.shop, "de", "theme", f.shop.id);
    expect(Object.values(theme.fields).every((v) => v.startsWith("[DE] "))).toBe(true);
    // Nothing left: no run, no spend.
    expect(await translateStoreWithAi(f.ctx, f.shop, "de")).toMatchObject({ runId: null, saved: 0, left: 0 });
    await expect(translateStoreWithAi(f.ctx, f.shop, "es")).rejects.toThrow("Turn that language on first.");
    const runs = await f.db.query.agentRuns.findMany({ where: eq(schema.agentRuns.agent, "translator") });
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => r.costMicros > 0)).toBe(true);
  });

  it("carries languages and translations into a copied store", async () => {
    const f = await setup();
    const { lamp } = f.products;
    const page = await createPage(f.db, f.shop.id, { title: "Shipping", body: "We ship worldwide." });
    await saveTranslation(f.db, f.shop, { language: "de", kind: "product", refId: lamp.id, fields: { title: "Lampe" } });
    await saveTranslation(f.db, f.shop, { language: "fr", kind: "page", refId: page.id, fields: { title: "Livraison" } });
    // Text that names the store (like "Welcome to …") changes with the new store's name.
    const strings = themeStrings(await getPublishedTheme(f.db, f.shop));
    const named = strings.find((x) => x.includes(f.shop.name))!;
    const plain = strings.find((x) => !x.includes(f.shop.name))!;
    await saveTranslation(f.db, f.shop, { language: "de", kind: "theme", refId: f.shop.id, fields: { [named]: "Willkommen", [plain]: "Übersetzt" } });

    const file = JSON.parse(JSON.stringify(await exportStore(f.db, f.shop.id)));
    expect(file.store.languages).toEqual(["de", "fr"]);
    expect(file.translations).toHaveLength(3);
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    const result = await importStore(f.db, copy.id, file);
    expect(result.translations).toBe(3);

    const shop = (await f.db.query.shops.findFirst({ where: eq(schema.shops.id, copy.id) }))!;
    expect(shop.languages).toEqual(["de", "fr"]);
    const summary = await translationSummary(f.db, shop);
    expect(summary.map((s) => [s.language, s.done, s.outdated])).toEqual([["de", 1, 1], ["fr", 1, 0]]);
    expect(themeStrings(await localizedTheme(f.db, shop, "de"))).toContain("Übersetzt");
    const copiedLamp = (await f.db.query.products.findFirst({ where: and(eq(schema.products.shopId, copy.id), eq(schema.products.handle, lamp.handle)) }))!;
    expect((await localizeProducts(f.db, copy.id, "de", [copiedLamp]))[0]!.title).toBe("Lampe");
  });
});
