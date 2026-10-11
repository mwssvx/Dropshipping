import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, editProductPhotos, exportStore, importStore, photoText, seoReport, setPhotoTexts } from "../src";
import { makeFixture } from "../evals/fixture";

const A = "https://img.example/lamp-a.jpg";
const B = "https://img.example/lamp-b.jpg";
const C = "https://img.example/lamp-c.jpg";

describe("photo descriptions", () => {
  it("describes each photo, falls back to the product's name, and follows the photo when it moves", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const id = f.products.lamp.id;
    for (const url of [A, B, C]) await editProductPhotos(f.db, shop.id, id, { kind: "add", url });
    const load = async () => (await f.db.query.products.findFirst({ where: eq(schema.products.id, id) }))!;

    expect(photoText(await load(), A, 0, 3)).toBe("Sunset Projection Lamp, photo 1 of 3");
    expect(photoText(await load(), A)).toBe("Sunset Projection Lamp");

    expect(await setPhotoTexts(f.db, shop.id, id, ["  Lamp glowing   orange on a bedroom wall ", "", "The lamp's remote"])).toBe(2);
    let p = await load();
    expect(p.imageAlts).toEqual({ [A]: "Lamp glowing orange on a bedroom wall", [C]: "The lamp's remote" });
    expect(photoText(p, A, 0, 3)).toBe("Lamp glowing orange on a bedroom wall");
    expect(photoText(p, B, 1, 3)).toBe("Sunset Projection Lamp, photo 2 of 3");

    await expect(setPhotoTexts(f.db, shop.id, id, ["x".repeat(126), "", ""])).rejects.toThrow("Keep each description to 125 characters. Photo 1 is 126.");
    // Written against an older page: the photos changed in between.
    await expect(setPhotoTexts(f.db, shop.id, id, ["Only one"])).rejects.toThrow("The photos changed");
    expect((await load()).imageAlts[A]).toBe("Lamp glowing orange on a bedroom wall");

    // The description stays with its photo when it becomes the main one, and goes when it's removed.
    await editProductPhotos(f.db, shop.id, id, { kind: "move", index: 2, to: "cover" });
    p = await load();
    expect(p.images[0]).toBe(C);
    expect(p.imageAlts[C]).toBe("The lamp's remote");
    await editProductPhotos(f.db, shop.id, id, { kind: "remove", index: 0 });
    expect((await load()).imageAlts).toEqual({ [A]: "Lamp glowing orange on a bedroom wall" });
  });

  it("lists products on sale with photos to describe, and carries descriptions in a store export", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const id = f.products.lamp.id;
    await f.db.update(schema.products).set({ status: "active" }).where(eq(schema.products.id, id));
    for (const url of [A, B]) await editProductPhotos(f.db, shop.id, id, { kind: "add", url });

    let report = await seoReport(f.db, shop.id);
    expect(report.undescribed.find((p) => p.id === id)).toEqual({ id, title: "Sunset Projection Lamp", photos: 2 });
    await setPhotoTexts(f.db, shop.id, id, ["Lamp glowing orange", ""]);
    report = await seoReport(f.db, shop.id);
    expect(report.undescribed.find((p) => p.id === id)?.photos).toBe(1);
    await setPhotoTexts(f.db, shop.id, id, ["Lamp glowing orange", "Lamp switched off"]);
    report = await seoReport(f.db, shop.id);
    expect(report.undescribed.find((p) => p.id === id)).toBeUndefined();

    const data = await exportStore(f.db, shop.id);
    const exported = data.products.find((p) => p.handle === f.products.lamp.handle)!;
    expect(exported.photo_descriptions).toEqual({ [A]: "Lamp glowing orange", [B]: "Lamp switched off" });
    // A description for a photo that isn't in the list is dropped on the way in.
    exported.photo_descriptions = { ...exported.photo_descriptions, "https://img.example/gone.jpg": "Gone" };
    const g = await makeFixture(new DemoModel());
    const target = await g.shop();
    await g.db.delete(schema.products).where(eq(schema.products.shopId, target.id));
    await importStore(g.db, target.id, data);
    const copied = await g.db.query.products.findFirst({ where: eq(schema.products.handle, f.products.lamp.handle) });
    expect(copied!.imageAlts).toEqual({ [A]: "Lamp glowing orange", [B]: "Lamp switched off" });
  });
});
