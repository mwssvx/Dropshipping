import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  DemoModel,
  FakeSupplier,
  mostWanted,
  pruneStockAlerts,
  requestStockAlert,
  sendStockAlerts,
  SupplierError,
  suppliersFrom,
  syncProductStock,
  syncSupplierStock,
  waitingForProduct,
  type SupplierProduct,
} from "../src";
import { DAY, makeFixture } from "../evals/fixture";

/** The demo supplier, with stock and cost changed (or the listing taken down) by the test. */
class ChangingSupplier extends FakeSupplier {
  stock: Record<string, number | null> = {};
  cost: Record<string, number> = {};
  gone = false;
  override async getProductFromUrl(url: string): Promise<SupplierProduct> {
    if (this.gone) throw new SupplierError("product_unavailable", "That listing was removed.");
    const p = await super.getProductFromUrl(url);
    return { ...p, variants: p.variants.map((v) => ({ ...v, stock: v.ref in this.stock ? this.stock[v.ref]! : v.stock, costMinor: this.cost[v.ref] ?? v.costMinor })) };
  }
}

async function setup() {
  const f = await makeFixture(new DemoModel());
  const supplier = new ChangingSupplier();
  f.ctx.suppliers = suppliersFrom([supplier]);
  const [v] = await f.variants(f.products.lamp.id);
  const ctx = { ...f.ctx, storeAddress: () => "https://glow.example" };
  return { ...f, supplier, variant: v!, ctx };
}

describe("supplier stock sync", () => {
  it("copies the supplier's stock and cost, and a removed listing sells out", async () => {
    const f = await setup();
    const shop = await f.shop();
    f.supplier.stock[f.variant.supplierVariantRef!] = 0;
    f.supplier.cost[f.variant.supplierVariantRef!] = f.variant.costMinor! + 200;
    const { changes } = await syncProductStock(f.ctx, shop.id, f.products.lamp.id);
    expect(changes).toEqual([expect.objectContaining({ variantId: f.variant.id, stockAfter: 0, costBefore: f.variant.costMinor, costAfter: f.variant.costMinor! + 200 })]);
    expect((await f.variants(f.products.lamp.id))[0]).toMatchObject({ stock: 0, costMinor: f.variant.costMinor! + 200 });
    // Nothing new: nothing changes.
    expect((await syncProductStock(f.ctx, shop.id, f.products.lamp.id)).changes).toEqual([]);

    f.supplier.gone = true;
    const gone = await syncProductStock(f.ctx, shop.id, f.products.stand.id);
    expect(gone.gone).toBe(true);
    expect((await f.variants(f.products.stand.id)).every((v) => v.stock === 0)).toBe(true);

    // The schedule checks each product once a day; importing counts as a check.
    f.supplier.gone = false;
    expect((await syncSupplierStock(f.ctx)).checked).toBe(0);
    f.advance(2 * DAY);
    expect((await syncSupplierStock(f.ctx)).checked).toBe(3);
    expect((await syncSupplierStock(f.ctx)).checked).toBe(0);
  });
});

describe("back-in-stock alerts", () => {
  it("a buyer asks on a sold-out option and gets one email when it's back", async () => {
    const f = await setup();
    const shop = await f.shop();
    await expect(requestStockAlert(f.db, shop.id, { variantId: f.variant.id, email: "ada@example.com" })).rejects.toThrow("in stock now");

    await f.db.update(schema.variants).set({ stock: 0 }).where(eq(schema.variants.id, f.variant.id));
    await expect(requestStockAlert(f.db, shop.id, { variantId: f.variant.id, email: "not an email" })).rejects.toThrow("Enter your email");
    await requestStockAlert(f.db, shop.id, { variantId: f.variant.id, email: " Ada@Example.com " });
    await requestStockAlert(f.db, shop.id, { variantId: f.variant.id, email: "ada@example.com" }); // twice is fine
    await requestStockAlert(f.db, shop.id, { variantId: f.variant.id, email: "grace@example.com" });
    // Another store's option, or a draft product, can't be asked for.
    await expect(requestStockAlert(f.db, "00000000-0000-0000-0000-000000000000", { variantId: f.variant.id, email: "x@example.com" })).rejects.toThrow("isn't available");
    expect((await waitingForProduct(f.db, shop.id, f.products.lamp.id)).get(f.variant.id)).toBe(2);
    expect(await mostWanted(f.db, shop.id)).toEqual([{ productId: f.products.lamp.id, title: f.products.lamp.title, waiting: 2 }]);

    // Still sold out: nothing goes.
    expect(await sendStockAlerts(f.ctx)).toEqual({ sent: 0 });

    // The supplier restocks; the sync picks it up and both buyers hear once.
    f.supplier.stock[f.variant.supplierVariantRef!] = 40;
    await syncProductStock(f.ctx, shop.id, f.products.lamp.id);
    const before = f.mailer.sent.length;
    expect(await sendStockAlerts(f.ctx, { shopId: shop.id })).toEqual({ sent: 2 });
    const mail = f.mailer.sent.slice(before);
    expect(mail.map((m) => m.to).sort()).toEqual(["ada@example.com", "grace@example.com"]);
    expect(mail[0]).toMatchObject({ subject: `Back in stock: ${f.products.lamp.title}` });
    expect(mail[0]!.text).toContain(`https://glow.example/products/${f.products.lamp.handle}`);
    expect(await sendStockAlerts(f.ctx)).toEqual({ sent: 0 });
    expect((await waitingForProduct(f.db, shop.id, f.products.lamp.id)).size).toBe(0);

    // Sent requests are cleared after a month.
    await pruneStockAlerts(f.db, new Date(Date.now() + 31 * DAY));
    expect(await f.db.query.stockAlerts.findMany()).toEqual([]);
  });
});
