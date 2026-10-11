import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, lowestPricesBefore, salePrice, setLowestPriceNote, showsLowestPrice } from "../src";
import { makeFixture } from "../evals/fixture";

const DAY = 86_400_000;

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  const lamp = f.products.lamp;
  const [small, large] = await f.variants(lamp.id);
  const now = new Date();
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  // The lamp has been around for a while; its small one's prices over the last weeks.
  await f.db.update(schema.products).set({ createdAt: ago(100) }).where(eq(schema.products.id, lamp.id));
  await f.db.delete(schema.variantPrices).where(eq(schema.variantPrices.variantId, small!.id));
  await f.db.insert(schema.variantPrices).values([
    { variantId: small!.id, priceMinor: 3000, startsAt: ago(40) },
    { variantId: small!.id, priceMinor: 2500, startsAt: ago(10) },
    { variantId: small!.id, priceMinor: 3500, startsAt: ago(2) },
  ]);
  return { ...f, shop, lamp, small: small!, large: large!, now, ago };
}

describe("lowest price before a discount", () => {
  it("records every price an option has, by itself", async () => {
    const f = await setup();
    const before = await f.db.query.variantPrices.findMany({ where: eq(schema.variantPrices.variantId, f.large.id) });
    expect(before.map((p) => p.priceMinor)).toEqual([f.large.priceMinor]);
    await f.db.update(schema.variants).set({ priceMinor: f.large.priceMinor + 100 }).where(eq(schema.variants.id, f.large.id));
    await f.db.update(schema.variants).set({ stock: 3 }).where(eq(schema.variants.id, f.large.id)); // not a price change
    const after = await f.db.query.variantPrices.findMany({ where: eq(schema.variantPrices.variantId, f.large.id) });
    expect(after.map((p) => p.priceMinor)).toEqual([f.large.priceMinor, f.large.priceMinor + 100]);
  });

  it("finds the lowest price in the 30 days before a reduced price, counting earlier sales", async () => {
    const f = await setup();
    // Reduced today to 28.00, shown against 35.00.
    await f.db.update(schema.variants).set({ priceMinor: 2800, compareAtMinor: 3500 }).where(eq(schema.variants.id, f.small.id));
    const shown = [{ id: f.small.id, priceMinor: 2800, compareAtMinor: 3500 }, { id: f.large.id, priceMinor: f.large.priceMinor, compareAtMinor: null }];
    const product = { id: f.lamp.id, createdAt: f.ago(100), variants: shown };
    let lowest = await lowestPricesBefore(f.db, f.shop.id, product, null);
    // 30.00 when the 30 days began, 25.00 ten days ago, 35.00 two days ago: 25.00. The large one isn't reduced.
    expect([...lowest]).toEqual([[f.small.id, 2500]]);

    // A sale that ran a fortnight ago at 50% off counts at what it charged.
    await f.db.insert(schema.sales).values({ shopId: f.shop.id, title: "Flash", percentOff: 50, scope: "all", startsAt: f.ago(15), endsAt: f.ago(14) });
    lowest = await lowestPricesBefore(f.db, f.shop.id, product, null);
    expect(lowest.get(f.small.id)).toBe(1250);

    // During a running sale, the 30 days before it began count.
    const [running] = await f.db
      .insert(schema.sales)
      .values({ shopId: f.shop.id, title: "Autumn", percentOff: 20, scope: "all", startsAt: new Date(f.now.getTime() + 1000), endsAt: null })
      .returning();
    const during = salePrice(2800, 3500, running);
    const later = new Date(f.now.getTime() + 2000);
    lowest = await lowestPricesBefore(f.db, f.shop.id, { ...product, variants: [{ id: f.small.id, ...during }] }, running!, later);
    expect(lowest.get(f.small.id)).toBe(1250);
  });

  it("says nothing when the history doesn't reach back 30 days", async () => {
    const f = await setup();
    await f.db.delete(schema.variantPrices).where(eq(schema.variantPrices.variantId, f.small.id));
    await f.db.insert(schema.variantPrices).values({ variantId: f.small.id, priceMinor: 3500, startsAt: f.ago(5) });
    await f.db.update(schema.variants).set({ priceMinor: 2800, compareAtMinor: 3500 }).where(eq(schema.variants.id, f.small.id));
    const lowest = await lowestPricesBefore(f.db, f.shop.id, { id: f.lamp.id, createdAt: f.ago(100), variants: [{ id: f.small.id, priceMinor: 2800, compareAtMinor: 3500 }] }, null);
    expect(lowest.size).toBe(0);
    // A product added within the 30 days has its whole history.
    const fresh = await lowestPricesBefore(f.db, f.shop.id, { id: f.lamp.id, createdAt: f.ago(6), variants: [{ id: f.small.id, priceMinor: 2800, compareAtMinor: 3500 }] }, null);
    expect(fresh.get(f.small.id)).toBe(3500);
  });

  it("shows to visitors in Europe by default, or to everyone, or nobody", async () => {
    const f = await setup();
    expect(f.shop.lowestPriceNote).toBe("eu");
    expect(showsLowestPrice("eu", "de")).toBe(true);
    expect(showsLowestPrice("eu", "US")).toBe(false);
    expect(showsLowestPrice("eu", null)).toBe(false);
    expect(showsLowestPrice("everyone", "US")).toBe(true);
    expect(showsLowestPrice("off", "FR")).toBe(false);
    expect(await setLowestPriceNote(f.db, f.shop.id, "everyone")).toBe("everyone");
    await expect(setLowestPriceNote(f.db, f.shop.id, "sometimes")).rejects.toThrow("Pick who sees");
  });
});
