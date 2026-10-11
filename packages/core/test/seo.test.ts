import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, exportStore, productSearchListing, seoReport, setProductSeo, writeListing } from "../src";
import { makeFixture } from "../evals/fixture";

describe("search engine listings", () => {
  it("saves a search title and description, falling back to the product's own", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const id = f.products.lamp.id;
    await expect(setProductSeo(f.db, shopId, id, { title: "x".repeat(71), description: "" })).rejects.toThrow("70 characters");
    await expect(setProductSeo(f.db, shopId, id, { title: "", description: "y".repeat(161) })).rejects.toThrow("160 characters");
    expect(await setProductSeo(f.db, shopId, id, { title: "  Sunset   lamp for bedrooms ", description: "" })).toEqual({ seoTitle: "Sunset lamp for bedrooms", seoDescription: null });
    const product = (await f.db.query.products.findFirst({ where: eq(schema.products.id, id) }))!;
    const listing = productSearchListing(product);
    expect(listing.title).toBe("Sunset lamp for bedrooms");
    // No search description: the product's description, as plain text, cut to fit.
    expect(listing.description.length).toBeLessThanOrEqual(160);
    expect(listing.description).not.toMatch(/<|\n/);
    expect((await exportStore(f.db, shopId)).products.find((p) => p.handle === product.handle)!.search_listing).toEqual({ title: "Sunset lamp for bedrooms", description: null });
  });

  it("lists active products with listing problems", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const { lamp, stand, projector } = f.products;
    // The stand still has its supplier title ("HOT SALE 2024 NEW ..."); make it live.
    await f.db.update(schema.products).set({ status: "active", imageUrl: null, images: [] }).where(eq(schema.products.id, stand.id));
    await f.db.update(schema.products).set({ imageUrl: "https://img.example/lamp.jpg" }).where(eq(schema.products.id, lamp.id));
    await f.db.update(schema.products).set({ title: lamp.title, descriptionHtml: "Lamp", imageUrl: "https://img.example/p.jpg" }).where(eq(schema.products.id, projector.id));

    const report = await seoReport(f.db, shopId);
    expect(report.checked).toBe(3);
    const issues = Object.fromEntries(report.products.map((p) => [p.id, p.issues]));
    expect(issues[stand.id]).toEqual(expect.arrayContaining(["filler", "no_photo"]));
    expect(issues[projector.id]).toEqual(expect.arrayContaining(["duplicate_title", "no_description"]));
    expect(issues[lamp.id]).toEqual(["duplicate_title"]);

    // A search title of its own sorts out the duplicate for the lamp.
    await setProductSeo(f.db, shopId, lamp.id, { title: "Sunset projection lamp for bedrooms", description: "" });
    const after = await seoReport(f.db, shopId);
    expect(after.fine).toBe(1);
    expect(after.products.map((p) => p.id)).not.toContain(lamp.id);
  });

  it("has the AI listing writer fill in the search description", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await writeListing(f.ctx, shop, f.products.stand.id);
    const stand = (await f.db.query.products.findFirst({ where: eq(schema.products.id, f.products.stand.id) }))!;
    expect(stand.seoDescription).toBeTruthy();
    expect(stand.seoDescription!.length).toBeLessThanOrEqual(160);
  });
});
