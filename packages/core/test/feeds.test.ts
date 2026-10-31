import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  addShippingRate, setCustomsInfo, createGiftCardProduct, createSale, createShippingZone, DemoModel, validGtin, googleFeedXml, metaFeedCsv, percentOff, plainText, productFeed, saveTranslation, setShopLanguages,
} from "../src";
import { makeFixture } from "../evals/fixture";

const origin = "https://glow.example";

async function setup() {
  const f = await makeFixture(new DemoModel());
  // The demo supplier's products come without photos; feeds need one.
  for (const p of [f.products.lamp, f.products.projector]) {
    await f.db.update(schema.products).set({ images: [`https://img.example/${p.handle}.jpg`, `https://img.example/${p.handle}-2.jpg`], imageUrl: `https://img.example/${p.handle}.jpg` }).where(eq(schema.products.id, p.id));
  }
  return { ...f, shopRow: await f.shop() };
}

describe("product feeds", () => {
  it("lists every option of every product on sale, grouped by product, and says what kept others out", async () => {
    const f = await setup();
    const { lamp, projector } = f.products;
    await createGiftCardProduct(f.db, f.shopRow, [2500]);
    await f.db.update(schema.products).set({ images: [], imageUrl: null }).where(eq(schema.products.id, projector.id));
    const [small, large] = await f.variants(lamp.id);
    await f.db.update(schema.variants).set({ stock: 0, options: { Size: "Large", Colour: "Amber" } }).where(eq(schema.variants.id, large!.id));

    const { items, issues } = await productFeed(f.db, f.shopRow, { origin });
    // The lamp's two options; the projector has no photo; the gift card and the draft stand aren't listed.
    expect(items.map((i) => i.id)).toEqual([small!.id, large!.id]);
    expect(items[1]).toMatchObject({ groupId: lamp.id, title: `${lamp.title} – ${large!.title}`, inStock: false, size: "Large", color: "Amber", link: `${origin}/products/${lamp.handle}`, brand: "Glow Lamps" });
    expect(issues).toEqual([{ productId: projector.id, title: projector.title, problem: expect.stringContaining("Add a photo") }]);
  });

  it("puts a running sale in as the sale price with its dates, in both formats", async () => {
    const f = await setup();
    const { lamp } = f.products;
    const [small] = await f.variants(lamp.id);
    const start = new Date("2026-10-01T09:00:00Z");
    const end = new Date("2099-10-17T09:00:00Z");
    await createSale(f.db, f.shopRow.id, { title: "Autumn", percentOff: 20, scope: "products", productIds: [lamp.id], startsAt: start, endsAt: end }, start);
    const { items } = await productFeed(f.db, f.shopRow, { origin });
    const item = items.find((i) => i.id === small!.id)!;
    const regular = Math.max(small!.priceMinor, small!.compareAtMinor ?? 0);
    expect(item).toMatchObject({ priceMinor: regular, salePriceMinor: percentOff(small!.priceMinor, 20), saleDates: { start, end } });

    const xml = googleFeedXml(f.shopRow, origin, items);
    expect(xml).toContain('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">');
    expect(xml).toContain(`<g:id>${small!.id}</g:id><g:item_group_id>${lamp.id}</g:item_group_id>`);
    expect(xml).toContain(`<g:price>${(regular / 100).toFixed(2)} USD</g:price><g:sale_price>${(percentOff(small!.priceMinor, 20) / 100).toFixed(2)} USD</g:sale_price>`);
    expect(xml).toContain("<g:sale_price_effective_date>2026-10-01T09:00Z/2099-10-17T09:00Z</g:sale_price_effective_date>");
    expect(xml).toContain("<g:availability>in_stock</g:availability><g:price>");

    const csv = metaFeedCsv(items).split("\n");
    expect(csv[0]).toBe("id,item_group_id,title,description,availability,condition,price,sale_price,sale_price_effective_date,link,image_link,additional_image_link,brand,color,size,gtin,shipping,shipping_weight");
    expect(csv.find((l) => l.startsWith(small!.id))).toContain(`,in stock,new,${(regular / 100).toFixed(2)} USD,`);
  });

  it("follows a store language when asked, and reads descriptions as plain text", async () => {
    const f = await setup();
    const { lamp } = f.products;
    await setShopLanguages(f.db, f.shopRow.id, ["de"]);
    const shop = await f.shop();
    await saveTranslation(f.db, shop, { language: "de", kind: "product", refId: lamp.id, fields: { title: "Sonnenuntergangslampe", description: "" } });
    const de = await productFeed(f.db, shop, { origin, language: "de" });
    expect(de.language).toBe("de");
    const item = de.items.find((i) => i.groupId === lamp.id)!;
    expect(item.link).toBe(`${origin}/de/products/${lamp.handle}`);
    expect(item.title).toMatch(/^Sonnenuntergangslampe/);
    // A language the store doesn't offer is ignored.
    expect((await productFeed(f.db, shop, { origin, language: "fr" })).language).toBeNull();
    expect(plainText("<p>Soft &amp; warm</p><ul><li>USB</li><li>Timer</li></ul>")).toBe("Soft & warm USB Timer");
  });

  it("carries real barcodes, the shipping cost to the store's country and the weight", async () => {
    expect(validGtin("4006381333931")).toBe("4006381333931");
    expect(validGtin("0360-0029-1452")).toBe("036000291452");
    expect(validGtin("4006381333932")).toBeNull();
    expect(validGtin("SKU-123")).toBeNull();
    expect(validGtin("00000000")).toBeNull();

    const f = await setup();
    const zone = await createShippingZone(f.db, f.shopRow.id, { name: "Home", countries: [f.shopRow.country] });
    await addShippingRate(f.db, f.shopRow.id, zone.id, { name: "Standard", priceMinor: 499, freeOverMinor: null, minDays: 3, maxDays: 5 });
    const [small, large] = await f.variants(f.products.lamp.id);
    await f.db.update(schema.variants).set({ barcode: "4006381333931", sku: null, weightGrams: 350 }).where(eq(schema.variants.id, small!.id));
    await f.db.update(schema.variants).set({ barcode: "12345", sku: null }).where(eq(schema.variants.id, large!.id));
    const { items } = await productFeed(f.db, await f.shop(), { origin });
    const item = items.find((i) => i.id === small!.id)!;
    expect(item).toMatchObject({ gtin: "4006381333931", weightGrams: 350, shipping: { country: f.shopRow.country, priceMinor: 499 } });
    const xml = googleFeedXml(f.shopRow, origin, items);
    const entry = (id: string) => xml.split("<item>").find((e) => e.includes(`<g:id>${id}</g:id>`))!;
    expect(entry(small!.id)).toContain("<g:gtin>4006381333931</g:gtin>");
    expect(entry(small!.id)).not.toContain("identifier_exists");
    expect(entry(small!.id)).toContain(`<g:shipping><g:country>${f.shopRow.country}</g:country><g:price>4.99 USD</g:price>`);
    expect(entry(small!.id)).toContain("<g:shipping_weight>350 g</g:shipping_weight>");
    expect(entry(large!.id)).toContain("<g:identifier_exists>no</g:identifier_exists>");
    expect(metaFeedCsv(items).split("\n").find((l) => l.startsWith(small!.id))).toContain(`,4006381333931,${f.shopRow.country}::Standard:4.99 USD,350 g`);
    // Every physical option says where it ships from: home, unless it's sent from a warehouse abroad.
    expect(entry(small!.id)).toContain(`<g:ships_from_country>${f.shopRow.country}</g:ships_from_country>`);
    await setCustomsInfo(f.db, f.shopRow.id, f.products.lamp.id, { shipsFrom: "CN" });
    const abroad = await productFeed(f.db, await f.shop(), { origin });
    expect(abroad.items.filter((i) => i.groupId === f.products.lamp.id).every((i) => i.shipsFrom === "CN")).toBe(true);
    expect(abroad.items.filter((i) => i.groupId === f.products.projector.id).every((i) => i.shipsFrom === f.shopRow.country)).toBe(true);
    expect(googleFeedXml(f.shopRow, origin, abroad.items).split("<item>").find((e) => e.includes(`<g:id>${small!.id}</g:id>`))).toContain("<g:ships_from_country>CN</g:ships_from_country>");
  });
});
