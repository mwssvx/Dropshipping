import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { cardBadges, compactProducts, DemoModel, exportStore, importStore, listActiveProducts, productSoldOut, setBadgeSettings, setProductBadge, storefrontCatalog } from "../src";
import { makeFixture } from "../evals/fixture";

const now = new Date("2026-10-11T12:00:00Z");
const on = { sale: true, soldOut: true, newDays: 14 };

describe("product badges", () => {
  it("are worked out from the real price, stock and date", () => {
    expect(cardBadges(on, { priceMinor: 1599, compareAtMinor: 1999 }, now)).toEqual([{ kind: "sale", percent: 20 }]);
    // Rounded down: 33.3% off says 33%.
    expect(cardBadges(on, { priceMinor: 2000, compareAtMinor: 3000 }, now)).toEqual([{ kind: "sale", percent: 33 }]);
    // A compare-at price that isn't higher is no sale.
    expect(cardBadges(on, { priceMinor: 2000, compareAtMinor: 2000 }, now)).toEqual([]);
    expect(cardBadges(on, { priceMinor: 2000, createdAt: new Date("2026-10-01T12:00:00Z") }, now)).toEqual([{ kind: "new" }]);
    expect(cardBadges(on, { priceMinor: 2000, createdAt: new Date("2026-09-20T12:00:00Z") }, now)).toEqual([]);
    // Sold out says so instead of a sale; the merchant's own badge comes first, two at most.
    expect(cardBadges(on, { priceMinor: 1599, compareAtMinor: 1999, soldOut: true }, now)).toEqual([{ kind: "sold_out" }]);
    expect(cardBadges(on, { badge: "Bestseller", priceMinor: 1599, compareAtMinor: 1999, createdAt: now }, now)).toEqual([{ kind: "custom", text: "Bestseller" }, { kind: "sale", percent: 20 }]);
    // Each automatic badge can be turned off.
    expect(cardBadges({ sale: false, soldOut: false, newDays: 0 }, { priceMinor: 1599, compareAtMinor: 1999, createdAt: now, soldOut: true }, now)).toEqual([]);
    // Without settings, sale and sold out are on and "New" is off.
    expect(cardBadges(null, { priceMinor: 1599, compareAtMinor: 1999, createdAt: now }, now)).toEqual([{ kind: "sale", percent: 20 }]);
  });

  it("counts a pre-order as something that can be ordered", () => {
    const gone = [{ stock: 0 }, { stock: 0 }];
    expect(productSoldOut({ preorder: null, variants: gone }, now)).toBe(true);
    expect(productSoldOut({ preorder: null, variants: [{ stock: 0 }, { stock: null }] }, now)).toBe(false);
    expect(productSoldOut({ preorder: { shipsBy: "2026-11-20", limit: null }, variants: gone }, now)).toBe(false);
  });

  it("saves the store's choices and each product's own badge, and both travel in a store export", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    expect(shop.productBadges).toEqual({ sale: true, soldOut: true, newDays: 0 });
    await expect(setBadgeSettings(f.db, shop.id, { sale: true, soldOut: true, newDays: 91 })).rejects.toThrow("0 to 90 days");
    await setBadgeSettings(f.db, shop.id, { sale: false, soldOut: true, newDays: 30 });
    await expect(setProductBadge(f.db, shop.id, f.products.lamp.id, "This label is far too long")).rejects.toThrow("20 characters");
    expect(await setProductBadge(f.db, shop.id, f.products.lamp.id, "  Best   seller ")).toBe("Best seller");

    // Store lists carry what the cards need.
    const [lamp] = (await storefrontCatalog(f.db, shop.id)).products.filter((p) => p.id === f.products.lamp.id);
    expect(lamp).toMatchObject({ badge: "Best seller", soldOut: false });
    const [compact] = compactProducts((await listActiveProducts(f.db, shop.id)).filter((p) => p.id === f.products.lamp.id));
    expect(compact).toMatchObject({ badge: "Best seller", soldOut: false });

    const data = await exportStore(f.db, shop.id);
    expect(data.store.badges).toEqual({ sale: false, sold_out: true, new_days: 30 });
    const g = await makeFixture(new DemoModel());
    const target = await g.shop();
    await g.db.delete(schema.products).where(eq(schema.products.shopId, target.id));
    await importStore(g.db, target.id, data);
    expect((await g.shop()).productBadges).toEqual({ sale: false, soldOut: true, newDays: 30 });
    const copied = await g.db.query.products.findFirst({ where: eq(schema.products.handle, lamp!.handle) });
    expect(copied!.badge).toBe("Best seller");

    expect(await setProductBadge(f.db, shop.id, f.products.lamp.id, "")).toBeNull();
  });
});
