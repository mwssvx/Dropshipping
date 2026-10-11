import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  countCostAlerts,
  DemoModel,
  exportStore,
  FakeSupplier,
  listCostChanges,
  marginPercent,
  notifyCostChanges,
  priceFromCost,
  pricingRuleOf,
  resolveCostChange,
  setPriceWatch,
  suppliersFrom,
  syncProductStock,
  type SupplierProduct,
} from "../src";
import { makeFixture } from "../evals/fixture";

/** The demo supplier, with costs changed by the test. */
class PricedSupplier extends FakeSupplier {
  cost: Record<string, number> = {};
  override async getProductFromUrl(url: string): Promise<SupplierProduct> {
    const p = await super.getProductFromUrl(url);
    return { ...p, variants: p.variants.map((v) => ({ ...v, costMinor: this.cost[v.ref] ?? v.costMinor })) };
  }
}

describe("supplier price watch", () => {
  it("checks the settings", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    await expect(setPriceWatch(f.db, shopId, { minMarginPercent: 95, autoReprice: false })).rejects.toThrow("0% to 90%");
    await expect(setPriceWatch(f.db, shopId, { minMarginPercent: 2.5, autoReprice: false })).rejects.toThrow("whole percent");
    expect(await setPriceWatch(f.db, shopId, { minMarginPercent: 30, autoReprice: true })).toEqual({ minMarginPercent: 30, autoReprice: true });
    expect(marginPercent(1000, 750)).toBe(25);
    expect(marginPercent(0, 10)).toBe(0);
  });

  it("notes cost rises, emails when margin gets thin, and raises prices on request", async () => {
    const f = await makeFixture(new DemoModel());
    const supplier = new PricedSupplier();
    f.ctx.suppliers = suppliersFrom([supplier]);
    const shopId = (await f.shop()).id;
    const [small, large] = await f.variants(f.products.lamp.id);
    const notify = { db: f.db, mailer: f.mailer, adminUrl: (p: string) => `https://app.example${p}` };
    const sync = () => syncProductStock(f.ctx, shopId, f.products.lamp.id);
    const variant = async (id: string) => (await f.db.query.variants.findFirst({ where: eq(schema.variants.id, id) }))!;

    // Prices are 2,000 and 4,000. The small one's cost jumps to 1,800 (10% margin); the large
    // one's to 2,500 (37%), which is still above the 20% the store wants.
    await f.db.update(schema.variants).set({ priceMinor: 2000 }).where(eq(schema.variants.id, small!.id));
    await f.db.update(schema.variants).set({ priceMinor: 4000 }).where(eq(schema.variants.id, large!.id));
    supplier.cost[small!.supplierVariantRef!] = 1800;
    supplier.cost[large!.supplierVariantRef!] = 2500;
    await sync();
    let changes = await listCostChanges(f.db, await f.shop());
    expect(changes.map((c) => [c.variantId, c.costBeforeMinor, c.costAfterMinor, c.marginNow, c.belowTarget, c.status])).toEqual(
      expect.arrayContaining([
        [small!.id, small!.costMinor, 1800, 10, true, "open"],
        [large!.id, large!.costMinor, 2500, 37, false, "open"],
      ]),
    );
    expect(await countCostAlerts(f.db, await f.shop())).toBe(1);
    // A second sync with the same costs changes nothing.
    await sync();
    expect(await listCostChanges(f.db, await f.shop())).toHaveLength(2);

    // One email, about the thin one only.
    expect(await notifyCostChanges(notify)).toEqual({ sent: 1 });
    const mail = f.mailer.sent.at(-1)!;
    expect(mail).toMatchObject({ to: "owner@example.com", subject: "1 supplier price rise needs a look at Glow Lamps" });
    expect(mail.text).toContain(`Sunset Projection Lamp – ${small!.title}: cost`);
    expect(mail.text).toContain("price $20.00, margin 10%");
    expect(mail.text).not.toContain(large!.title);
    expect(mail.text).toContain("https://app.example/admin/price-changes");
    expect(await notifyCostChanges(notify)).toEqual({ sent: 0 });

    // It climbs again: still one thing to look at, with the first cost kept, and a fresh email.
    supplier.cost[small!.supplierVariantRef!] = 1900;
    await sync();
    changes = await listCostChanges(f.db, await f.shop());
    const thin = changes.find((c) => c.variantId === small!.id)!;
    expect(thin).toMatchObject({ costBeforeMinor: small!.costMinor, costAfterMinor: 1900, status: "open" });
    expect(await notifyCostChanges(notify)).toEqual({ sent: 1 });

    // Raise it: the pricing rule's price for the new cost.
    const rule = pricingRuleOf(await f.shop());
    const raised = await resolveCostChange(f.db, await f.shop(), thin.id, "raise");
    expect(raised).toMatchObject({ status: "raised", newPriceMinor: priceFromCost(1900, rule) });
    expect((await variant(small!.id)).priceMinor).toBe(priceFromCost(1900, rule));
    await expect(resolveCostChange(f.db, await f.shop(), thin.id, "keep")).rejects.toThrow("already dealt with");
    // Keep the other one.
    const healthy = changes.find((c) => c.variantId === large!.id)!;
    expect(await resolveCostChange(f.db, await f.shop(), healthy.id, "keep")).toMatchObject({ status: "kept" });
    expect(await countCostAlerts(f.db, await f.shop())).toBe(0);

    // With automatic repricing on, the store raises it and says so.
    await setPriceWatch(f.db, shopId, { minMarginPercent: 20, autoReprice: true });
    supplier.cost[large!.supplierVariantRef!] = 3000;
    await sync();
    const auto = (await listCostChanges(f.db, await f.shop())).find((c) => c.variantId === large!.id && c.status === "repriced")!;
    expect(auto).toMatchObject({ costBeforeMinor: 2500, costAfterMinor: 3000, priceMinor: 4000, newPriceMinor: priceFromCost(3000, rule) });
    expect((await variant(large!.id)).priceMinor).toBe(priceFromCost(3000, rule));
    expect(await notifyCostChanges(notify)).toEqual({ sent: 1 });
    expect(f.mailer.sent.at(-1)!.subject).toBe("We raised 1 price at Glow Lamps after supplier rises");
    expect(f.mailer.sent.at(-1)!.text).toContain(`price $40.00 → ${"$" + (priceFromCost(3000, rule) / 100).toFixed(2)}`);

    expect((await exportStore(f.db, shopId)).store.price_watch).toEqual({ min_margin_percent: 20, auto_reprice: true });

    // Cheaper again is good news, not a note.
    supplier.cost[large!.supplierVariantRef!] = 1000;
    await sync();
    expect((await listCostChanges(f.db, await f.shop())).filter((c) => c.status === "open")).toHaveLength(0);
  });
});
