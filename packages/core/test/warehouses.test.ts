import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { countryFromName, DemoModel, importProduct, previewImport, syncProductStock } from "../src";
import { makeFixture } from "../evals/fixture";

const FAN = "https://demo-supplier.test/p/desk-fan-warehouses";

describe("supplier warehouses", () => {
  it("reads supplier country names", () => {
    expect(countryFromName("China")).toBe("CN");
    expect(countryFromName("CZECH REPUBLIC")).toBe("CZ");
    expect(countryFromName("Russian Federation")).toBe("RU");
    expect(countryFromName("united states")).toBe("US");
    expect(countryFromName("Narnia")).toBeNull();
  });

  it("sells a listing from one warehouse without a Ships From option", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    expect(shop.country).toBe("US");

    // A US store gets the US warehouse by default: faster, no customs.
    const preview = await previewImport(f.db, f.ctx.suppliers, shop.id, FAN);
    expect(preview.warehouses.map((w) => [w.name, w.country])).toEqual([["China", "CN"], ["United States", "US"]]);
    expect(preview.warehouse).toBe("United States");
    expect(preview.shipsFrom).toBeNull();
    expect(preview.product.variants.every((v) => !("Ships From" in (v.options ?? {})) && v.shipDaysMax === 5)).toBe(true);

    const china = await previewImport(f.db, f.ctx.suppliers, shop.id, FAN, "China");
    expect(china.shipsFrom).toBe("CN");
    expect(china.product.variants.every((v) => v.ref.endsWith("-cn"))).toBe(true);
    const cheapest = Math.min(...china.product.variants.map((v) => v.costMinor));
    expect(preview.warehouses[0]!.lowestCostMinor).toBe(cheapest);

    const product = await importProduct(f.db, f.ctx.suppliers, shop.id, { url: FAN, title: "Desk Fan", prices: {}, publish: true, warehouse: "China" });
    expect(product.shipsFrom).toBe("CN");
    const variants = await f.db.query.variants.findMany({ where: eq(schema.variants.productId, product.id) });
    expect(variants.length).toBe(china.product.variants.length);
    for (const v of variants) {
      expect(v.supplierVariantRef).toMatch(/-cn$/);
      expect(Object.keys(v.options)).not.toContain("Ships From");
      expect(v.title).not.toContain("China");
    }

    // The daily stock check still finds every option from that warehouse.
    const sync = await syncProductStock(f.ctx, shop.id, product.id);
    expect(sync.gone).toBe(false);
    const after = await f.db.query.variants.findMany({ where: eq(schema.variants.productId, product.id) });
    expect(after.every((v) => (v.stock ?? 0) > 0)).toBe(true);

    // Listings without warehouses come in as before.
    const plain = await previewImport(f.db, f.ctx.suppliers, shop.id, "https://demo-supplier.test/p/sunset-projection-lamp");
    expect(plain.warehouses).toEqual([]);
    expect(plain.warehouse).toBeNull();
  });
});
