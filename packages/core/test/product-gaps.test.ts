import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, listProducts, missingDetails, parseProductQuery, productGaps, productPage, productsCsv } from "../src";
import { makeFixture } from "../evals/fixture";

describe("products that still lack something", () => {
  it("are counted and listed by what they lack", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp, projector, stand } = f.products;
    const set = (id: string, v: Partial<typeof schema.products.$inferInsert>) => f.db.update(schema.products).set(v).where(eq(schema.products.id, id));
    // The lamp is finished; the projector has a description of only markup and no photo.
    await set(lamp.id, { descriptionHtml: "<p>Warm light.</p>", imageUrl: "https://img.example/lamp.jpg", hsCode: "9405.40", originCountry: "CN" });
    await f.db.update(schema.variants).set({ weightGrams: 450 }).where(eq(schema.variants.productId, lamp.id));
    await set(projector.id, { descriptionHtml: "<p>&nbsp; </p><br>", imageUrl: null, hsCode: "9405.40", originCountry: null });
    // The stand is a download: no weight or customs needed, but still no description.
    await set(stand.id, { digital: true, descriptionHtml: "", status: "active", imageUrl: "https://img.example/stand.jpg" });

    const titles = async (missing: string, status?: string) =>
      (await productPage(f.db, shop.id, parseProductQuery((k) => (k === "missing" ? missing : k === "status" ? status : undefined)))).products.map((p) => p.title).sort();
    expect(await titles("photo")).toEqual(["Galaxy Projector"]);
    expect(await titles("description")).toEqual(["Galaxy Projector", stand.title].sort());
    expect(await titles("weight")).toEqual(["Galaxy Projector"]);
    expect(await titles("customs")).toEqual(["Galaxy Projector"]);
    expect(await productGaps(f.db, shop.id)).toEqual({ photo: 1, description: 2, weight: 1, customs: 1, cost: 0 });
    // An option with no cost makes the profit report count it as free.
    await f.db.update(schema.variants).set({ costMinor: null }).where(eq(schema.variants.productId, lamp.id));
    expect(await titles("cost")).toEqual(["Sunset Projection Lamp"]);
    // One product at a time (the app's list) follows the same rules as the filter.
    const each = new Map((await listProducts(f.db, shop.id)).map((p) => [p.title, missingDetails(p)]));
    expect(each.get(lamp.title)).toEqual(["cost"]);
    expect(each.get("Galaxy Projector")).toEqual(["photo", "description", "weight", "customs"]);
    expect(each.get(stand.title)).toEqual(["description"]);

    // Archived products drop out of the counts and the list, unless the archived list is asked for.
    await set(projector.id, { status: "archived" });
    expect(await productGaps(f.db, shop.id)).toEqual({ photo: 0, description: 1, weight: 0, customs: 0, cost: 1 });
    expect(await titles("photo")).toEqual([]);
    expect(await titles("photo", "archived")).toEqual(["Galaxy Projector"]);

    // An unknown value is no filter; the spreadsheet follows the filter.
    expect(parseProductQuery((k) => (k === "missing" ? "price" : undefined)).missing).toBeUndefined();
    const csv = await productsCsv(f.db, shop.id, { missing: "description" });
    expect(csv).toContain(stand.title);
    expect(csv).not.toContain("Sunset Projection Lamp");
  });
});
