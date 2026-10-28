import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, parseProductQuery, productMargins, productPage } from "../src";
import { makeFixture } from "../evals/fixture";

describe("products that earn little", () => {
  it("are counted and listed by margin, leaving out options with no cost", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp, projector, stand } = f.products;
    const price = (productId: string, priceMinor: number, costMinor: number | null) =>
      f.db.update(schema.variants).set({ priceMinor, costMinor }).where(eq(schema.variants.productId, productId));
    // Lamp keeps 50%; projector 15% (thin); stand sells below cost but is a draft.
    await price(lamp.id, 2000, 1000);
    await price(projector.id, 2000, 1700);
    await price(stand.id, 1000, 1200);
    const titles = async (margin: string, status?: string) =>
      (await productPage(f.db, shop.id, parseProductQuery((k) => (k === "margin" ? margin : k === "status" ? status : undefined)))).products.map((p) => p.title).sort();
    expect(await titles("low")).toEqual(["Galaxy Projector", stand.title].sort());
    expect(await titles("loss")).toEqual([stand.title]);
    expect(await productMargins(f.db, shop.id)).toEqual({ low: 2, loss: 1 });

    // Exactly 20% is not under 20%; no cost can't be judged.
    await price(projector.id, 2000, 1600);
    await price(stand.id, 1000, null);
    expect(await productMargins(f.db, shop.id)).toEqual({ low: 0, loss: 0 });

    // Archived products drop out unless the archived list is asked for.
    await price(projector.id, 2000, 2500);
    await f.db.update(schema.products).set({ status: "archived" }).where(eq(schema.products.id, projector.id));
    expect(await titles("loss")).toEqual([]);
    expect(await titles("loss", "archived")).toEqual(["Galaxy Projector"]);
    expect(parseProductQuery((k) => (k === "margin" ? "high" : undefined)).margin).toBeUndefined();
  });
});
