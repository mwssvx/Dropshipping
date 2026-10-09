import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  applyRepricing, compareAtFor, DemoModel, DEMO_SUPPLIER_LINKS, importProduct, keepsFromSale, previewImport, previewRepricing, priceFromCost, setPricingRule,
} from "../src";
import { makeFixture } from "../evals/fixture";

describe("pricing rules", () => {
  it("rounds up to the chosen ending and adds a crossed-out price", () => {
    const rule = (r: Partial<Parameters<typeof priceFromCost>[1] & object>) => ({ kind: "multiplier" as const, value: 2.5, ending: "99" as const, compareAtPercent: null, minPriceMinor: 99, ...r });
    expect(priceFromCost(559)).toBe(1399); // 13.975 → 13.99, as imports always did
    expect(priceFromCost(560)).toBe(1399); // 14.00 → 13.99
    expect(priceFromCost(561)).toBe(1499); // 14.03 → 14.99
    expect(priceFromCost(560, rule({ ending: "95" }))).toBe(1395);
    expect(priceFromCost(560, rule({ ending: "00" }))).toBe(1400);
    expect(priceFromCost(561, rule({ ending: "none" }))).toBe(1403);
    expect(priceFromCost(500, rule({ kind: "fixed", value: 1000 }))).toBe(1499);
    expect(priceFromCost(10, rule({ minPriceMinor: 500 }))).toBe(500);
    expect(compareAtFor(1399, rule({ compareAtPercent: 30 }))).toBe(1899);
    expect(compareAtFor(1399, rule({}))).toBeNull();
    expect(keepsFromSale({ plan: "free" }, 1399, 559)).toBe(1399 - 559 - Math.round(1399 * 0.029) - 30 - Math.round(1399 * 0.02));
  });

  it("prices imports with the store's rule and reprices existing products after a preview", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await expect(setPricingRule(f.db, shop.id, { kind: "multiplier", value: 0.5, ending: "99", compareAtPercent: null })).rejects.toThrow("1.05 to 20");
    await expect(setPricingRule(f.db, shop.id, { kind: "fixed", value: 0, ending: "99", compareAtPercent: null })).rejects.toThrow("on top of cost");
    await setPricingRule(f.db, shop.id, { kind: "multiplier", value: 3, ending: "95", compareAtPercent: 20 });
    const updated = await f.shop();

    const before = await previewRepricing(f.db, updated);
    expect(before.rows.length).toBeGreaterThan(0);
    for (const r of before.rows) {
      expect(r.newPriceMinor % 100).toBe(95);
      expect(r.newPriceMinor).toBeGreaterThanOrEqual(r.costMinor * 3 - 5);
      expect(r.newCompareAtMinor).toBe(compareAtFor(r.newPriceMinor, updated.pricingRule!));
    }
    // Only the lamp first; then the rest.
    const lamp = f.products.lamp.id;
    expect(await applyRepricing(f.db, updated, [lamp])).toMatchObject({ products: 1 });
    expect((await previewRepricing(f.db, updated)).rows.some((r) => r.productId === lamp)).toBe(false);
    await applyRepricing(f.db, updated);
    expect((await previewRepricing(f.db, updated)).rows).toEqual([]);
    await expect(applyRepricing(f.db, updated)).rejects.toThrow("Nothing to change");

    // New imports follow the rule, including the crossed-out price.
    const url = DEMO_SUPPLIER_LINKS[1]!;
    const preview = await previewImport(f.db, f.ctx.suppliers, shop.id, url.replace("magnetic-phone-stand", "desk-fan"));
    const v = preview.product.variants[0]!;
    expect(preview.suggestedPrices[v.ref]).toBe(priceFromCost(v.costMinor, updated.pricingRule!));
    const created = await importProduct(f.db, f.ctx.suppliers, shop.id, { url: url.replace("magnetic-phone-stand", "desk-fan"), title: "Desk fan", prices: {}, publish: true });
    const [first] = await f.db.query.variants.findMany({ where: eq(schema.variants.productId, created.id) });
    expect(first).toMatchObject({ priceMinor: preview.suggestedPrices[first!.supplierVariantRef!], compareAtMinor: compareAtFor(first!.priceMinor, updated.pricingRule!) });
  });
});
