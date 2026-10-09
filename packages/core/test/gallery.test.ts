import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createProduct, createShop, DemoModel, editProductPhotos, exportStore, importStore, MAX_PHOTOS, photoColumns, productPhotos, setProductImage, signUp, updateProduct } from "../src";
import { makeFixture } from "../evals/fixture";

const photo = (n: number) => `https://cdn.example.com/lamp-${n}.jpg`;

describe("product photos", () => {
  it("adds, reorders and removes photos, keeping the cover in step", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const p = await createProduct(f.db, shop.id, { title: "Moon lamp", imageUrl: photo(1), variants: [{ priceMinor: 2000 }] });
    expect(p).toMatchObject({ imageUrl: photo(1), images: [photo(1)] });

    const edit = (e: Parameters<typeof editProductPhotos>[3]) => editProductPhotos(f.db, shop.id, p.id, e);
    await edit({ kind: "add", url: photo(2) });
    await edit({ kind: "add", url: photo(3) });
    expect(await edit({ kind: "add", url: photo(2) })).toEqual([photo(1), photo(3), photo(2)]); // adding again moves it last
    expect(await edit({ kind: "move", index: 2, to: "cover" })).toEqual([photo(2), photo(1), photo(3)]);
    expect(await edit({ kind: "move", index: 0, to: "later" })).toEqual([photo(1), photo(2), photo(3)]);
    expect(await edit({ kind: "move", index: 2, to: "earlier" })).toEqual([photo(1), photo(3), photo(2)]);
    expect(await edit({ kind: "move", index: 2, to: "later" })).toEqual([photo(1), photo(3), photo(2)]); // already last
    expect(await edit({ kind: "remove", index: 0 })).toEqual([photo(3), photo(2)]);
    expect((await f.db.query.products.findFirst({ where: eq(schema.products.id, p.id) }))!.imageUrl).toBe(photo(3));

    await expect(edit({ kind: "add", url: "http://insecure.example.com/x.jpg" })).rejects.toThrow("https");
    await expect(edit({ kind: "add", url: "javascript:alert(1)" })).rejects.toThrow("https");
    await expect(edit({ kind: "remove", index: 5 })).rejects.toThrow("isn't there");
    await expect(editProductPhotos(f.db, "00000000-0000-0000-0000-000000000000", p.id, { kind: "remove", index: 0 })).rejects.toThrow("Product not found");
    for (let i = 10; i < 10 + MAX_PHOTOS - 2; i++) await edit({ kind: "add", url: photo(i) });
    await expect(edit({ kind: "add", url: photo(99) })).rejects.toThrow(`up to ${MAX_PHOTOS} photos`);

    // An app upload (our own media address, http in development) becomes the cover.
    await edit({ kind: "remove", index: 9 });
    const upload = "http://localhost:3000/api/media/0b9f8a52-3c1e-4d5b-9a8e-1f2d3c4b5a69";
    expect((await setProductImage(f.db, shop.id, p.id, upload)).images[0]).toBe(upload);

    // Saving the form without an image address leaves the photos alone.
    await updateProduct(f.db, shop.id, p.id, { title: "Moon lamp", variants: [{ priceMinor: 2100 }] });
    const after = (await f.db.query.products.findFirst({ where: eq(schema.products.id, p.id) }))!;
    expect(after.images).toHaveLength(MAX_PHOTOS);
    expect(after.imageUrl).toBe(upload);
  });

  it("travels with the store export, and older rows still show their cover", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await editProductPhotos(f.db, shop.id, f.products.lamp.id, { kind: "add", url: photo(1) });
    await editProductPhotos(f.db, shop.id, f.products.lamp.id, { kind: "add", url: photo(2) });
    const data = await exportStore(f.db, shop.id);
    expect(data.products.find((p) => p.handle === f.products.lamp.handle)!.images).toEqual([photo(1), photo(2)]);

    expect(photoColumns([photo(1), " " + photo(1), "ftp://x", photo(2)])).toEqual({ images: [photo(1), photo(2)], imageUrl: photo(1) });
    expect(productPhotos({ images: [], imageUrl: photo(7) })).toEqual([photo(7)]);
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, JSON.parse(JSON.stringify(data)));
    const copied = await f.db.query.products.findMany({ where: eq(schema.products.shopId, copy.id) });
    expect(copied.find((p) => p.handle === f.products.lamp.handle)).toMatchObject({ images: [photo(1), photo(2)], imageUrl: photo(1) });
  });
});
