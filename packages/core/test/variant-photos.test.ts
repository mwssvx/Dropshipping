import { describe, expect, it } from "vitest";
import {
  combineOptions,
  createProduct,
  DemoModel,
  editProductPhotos,
  FakeSupplier,
  importProduct,
  quoteCart,
  setVariantPhotos,
  suppliersFrom,
  updateProduct,
  variantPhotoRows,
  type SupplierProduct,
} from "../src";
import { makeFixture } from "../evals/fixture";

const RED = "https://cdn.example.com/red.jpg";
const BLUE = "https://cdn.example.com/blue.jpg";
const COVER = "https://cdn.example.com/cover.jpg";

async function tee() {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  const combos = combineOptions([{ name: "Color", values: ["Red", "Blue"] }, { name: "Size", values: ["S", "M"] }]);
  const p = await createProduct(f.db, shop.id, { title: "Tee", status: "active", variants: combos.map((c) => ({ ...c, priceMinor: 2000, stock: 5 })) });
  for (const url of [COVER, RED, BLUE]) await editProductPhotos(f.db, shop.id, p.id, { kind: "add", url });
  return { f, shop, p };
}

describe("variant photos", () => {
  it("gives each colour its photo, which new sizes and the cart pick up", async () => {
    const { f, shop, p } = await tee();
    // Nothing set yet: one row per colour.
    expect(variantPhotoRows(await f.variants(p.id))).toMatchObject({ option: "Color", rows: [{ key: "Red", url: null }, { key: "Blue", url: null }] });

    expect(await setVariantPhotos(f.db, shop.id, p.id, "Color", { Red: RED, Blue: BLUE })).toBe(4);
    const vs = await f.variants(p.id);
    expect(vs.map((v) => [v.title, v.imageUrl])).toEqual([["Red / S", RED], ["Red / M", RED], ["Blue / S", BLUE], ["Blue / M", BLUE]]);
    expect(variantPhotoRows(vs).rows.map((r) => r.url)).toEqual([RED, BLUE]);

    // Only the product's own photos, and only options that exist.
    await expect(setVariantPhotos(f.db, shop.id, p.id, "Color", { Red: "https://elsewhere.example.com/x.jpg" })).rejects.toThrow("product's photos");
    await expect(setVariantPhotos(f.db, shop.id, p.id, "Color", { Green: RED })).rejects.toThrow("Reload the page");

    // Adding size L: Red / L starts with the red photo.
    const next = combineOptions([{ name: "Color", values: ["Red", "Blue"] }, { name: "Size", values: ["S", "M", "L"] }]);
    await updateProduct(f.db, shop.id, p.id, {
      title: "Tee",
      status: "active",
      variants: next.map((c) => ({ ...c, id: vs.find((v) => v.title === c.title)?.id, priceMinor: 2000 })),
    });
    const after = await f.variants(p.id);
    expect(after.find((v) => v.title === "Red / L")!.imageUrl).toBe(RED);
    expect(after.find((v) => v.title === "Blue / L")!.imageUrl).toBe(BLUE);

    // The cart shows the picked colour's photo; a variant without one shows the cover.
    const blue = after.find((v) => v.title === "Blue / M")!;
    const quote = await quoteCart(f.db, shop, [{ variantId: blue.id, quantity: 1 }]);
    expect(quote.items[0]!.imageUrl).toBe(BLUE);
    await setVariantPhotos(f.db, shop.id, p.id, null, { [blue.id]: null });
    expect((await quoteCart(f.db, shop, [{ variantId: blue.id, quantity: 1 }])).items[0]!.imageUrl).toBe(COVER);

    // Removing the red photo from the product clears it from the red options.
    const photos = (await f.db.query.products.findFirst({ where: (t, { eq }) => eq(t.id, p.id) }))!.images;
    await editProductPhotos(f.db, shop.id, p.id, { kind: "remove", index: photos.indexOf(RED) });
    expect((await f.variants(p.id)).filter((v) => v.imageUrl === RED)).toEqual([]);
  });

  it("falls back to a row per variant when the options don't split by photo", async () => {
    const rows = variantPhotoRows([
      { id: "a", title: "One", options: {}, imageUrl: null },
      { id: "b", title: "Two", options: {}, imageUrl: RED },
    ]);
    expect(rows).toEqual({ option: null, rows: [{ key: "a", label: "One", url: null }, { key: "b", label: "Two", url: RED }] });
    // Only sizes: a row per size.
    expect(variantPhotoRows([
      { id: "a", title: "S", options: { Size: "S" }, imageUrl: null },
      { id: "b", title: "M", options: { Size: "M" }, imageUrl: null },
    ]).option).toBe("Size");
  });

  it("imports the supplier's photo for each variant", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const fake = new FakeSupplier();
    const product: SupplierProduct = {
      ref: "demo-mug",
      sourceUrl: "https://demo-supplier.test/p/mug",
      title: "Mug",
      description: "",
      images: Array.from({ length: 10 }, (_, i) => `https://cdn.example.com/${i}.jpg`),
      variants: [
        { ref: "w", title: "White", options: { Color: "White" }, imageUrl: "https://cdn.example.com/white.jpg", costMinor: 300, stock: 9, shipDaysMin: 5, shipDaysMax: 9 },
        { ref: "k", title: "Black", options: { Color: "Black" }, imageUrl: "http://insecure.example.com/black.jpg", costMinor: 300, stock: 9, shipDaysMin: 5, shipDaysMax: 9 },
      ],
    };
    const suppliers = suppliersFrom([Object.assign(Object.create(fake), { getProductFromUrl: async () => product })]);
    const created = await importProduct(f.db, suppliers, shop.id, { url: product.sourceUrl, title: "Mug", prices: {}, publish: false });
    // The cover stays first and the variant's photo makes the cut of ten.
    expect(created.images[0]).toBe("https://cdn.example.com/0.jpg");
    expect(created.images[1]).toBe("https://cdn.example.com/white.jpg");
    expect(created.images).toHaveLength(10);
    expect((await f.variants(created.id)).map((v) => v.imageUrl)).toEqual(["https://cdn.example.com/white.jpg", null]);
  });
});
