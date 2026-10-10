import { describe, expect, it } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  createProduct,
  createShop,
  DEMO_SUPPLIER_HOST,
  DemoModel,
  editOrder,
  exportStore,
  FakeSupplier,
  importStore,
  removeBackupSupplier,
  sellableStock,
  setBackupSupplier,
  signUp,
  suppliersFrom,
  syncProductStock,
  type SupplierAdapter,
} from "../src";
import { DAY, makeFixture } from "../evals/fixture";

const BACKUP = `https://${DEMO_SUPPLIER_HOST}/p/galaxy-projector`;

describe("backup suppliers", () => {
  it("sends an order to the backup when the main supplier is out of stock, and sells its stock", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const projector = f.products.projector;

    await expect(setBackupSupplier(f.db, f.ctx.suppliers, shop.id, projector.id, projector.sourceUrl!)).rejects.toThrow("already comes from");
    await expect(setBackupSupplier(f.db, f.ctx.suppliers, shop.id, projector.id, `https://${DEMO_SUPPLIER_HOST}/p/sunset-lamp-backup`)).rejects.toThrow(
      "None of that listing's options (Default) match this product's (Small, Large).",
    );
    const own = await createProduct(f.db, shop.id, { title: "Hand-made mug", variants: [{ title: "Default", priceMinor: 2000 }] });
    await expect(setBackupSupplier(f.db, f.ctx.suppliers, shop.id, own.id, BACKUP)).rejects.toThrow("imported from a supplier's listing");

    const { backup, unmatched } = await setBackupSupplier(f.db, f.ctx.suppliers, shop.id, projector.id, BACKUP);
    expect(unmatched).toEqual([]);
    const [small, large] = await f.variants(projector.id);
    expect(backup.variants[small!.id]).toMatchObject({ ref: "demo-galaxy-projector-small" });
    expect(backup.variants[large!.id]!.costMinor).toBeGreaterThan(large!.costMinor!);

    // The store can sell what either supplier has.
    expect(sellableStock(0, { stock: 5 })).toBe(5);
    expect(sellableStock(2, { stock: null })).toBeNull();
    await syncProductStock(f.ctx, shop.id, projector.id);
    const [synced] = await f.variants(projector.id);
    expect(synced!.stock).toBe(2 + backup.variants[small!.id]!.stock!);

    // The main supplier is out of stock, so it goes to the backup instead of becoming a problem.
    const order = await f.outOfStockOrder();
    expect(order.fulfillmentStatus).toBe("sent_to_supplier");
    const [sent] = await f.db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, order.id) });
    expect(sent).toMatchObject({ status: "placed", problemCode: null, backupNote: "The main supplier was out of stock, so it went to the backup supplier (Demo supplier)." });
    const [line] = await f.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
    expect(line!.unitCostMinor).toBe(backup.variants[small!.id]!.costMinor);

    // Store files carry the backup, matched to options by name.
    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shop.id)));
    expect(file.products.find((p: { title: string }) => p.title === "Galaxy Projector").backup).toMatchObject({ provider: "fake", url: BACKUP, variants: { Small: { ref: "demo-galaxy-projector-small" } } });
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, file);
    const copied = (await f.db.query.products.findFirst({ where: and(eq(schema.products.shopId, copy.id), eq(schema.products.title, "Galaxy Projector")) }))!;
    expect(Object.values(copied.backup!.variants).map((v) => v.ref).sort()).toEqual(["demo-galaxy-projector-large", "demo-galaxy-projector-small"]);

    // Without a backup it's a problem for the merchant, as before.
    await removeBackupSupplier(f.db, shop.id, projector.id);
    expect((await f.outOfStockOrder()).fulfillmentStatus).toBe("problem");
  });

  it("uses a backup at another supplier, and redoes it there when the order changes", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    // A second supplier on another site, selling the same demo catalog.
    const demo = new FakeSupplier({ shipAfterMs: DAY, now: () => f.ctx.now!().getTime() });
    const other: SupplierAdapter = {
      name: "cj",
      label: "CJ Dropshipping",
      matchesUrl: (u) => u.hostname === "cj.test",
      getProductFromUrl: async (raw) => ({ ...(await demo.getProductFromUrl(raw.replace("cj.test", DEMO_SUPPLIER_HOST))), sourceUrl: raw }),
      placeOrder: (input) => demo.placeOrder(input),
      getTracking: (ref) => demo.getTracking(ref),
      cancelOrder: (ref) => demo.cancelOrder(ref),
    };
    f.ctx.suppliers = suppliersFrom([...f.ctx.suppliers.available, other]);
    await setBackupSupplier(f.db, f.ctx.suppliers, shop.id, f.products.projector.id, "https://cj.test/p/galaxy-projector");
    const cj = (await f.db.query.suppliers.findFirst({ where: eq(schema.suppliers.provider, "cj") }))!;

    const order = await f.outOfStockOrder();
    const live = () => f.db.query.fulfillments.findMany({ where: and(eq(schema.fulfillments.orderId, order.id), ne(schema.fulfillments.status, "cancelled")) });
    expect(await live()).toEqual([expect.objectContaining({ supplierId: cj.id, status: "placed", backupForSupplierId: f.products.projector.supplierId })]);
    expect((await live())[0]!.backupNote).toContain("(CJ Dropshipping)");

    // A new address cancels the backup's order and places it again there, never at the main supplier too.
    const before = (await live())[0]!;
    f.advance(60_000);
    expect(await editOrder(f.ctx, shop.id, order.id, { address: { ...order.shippingAddress, line1: "9 Oak Ave" } }, "merchant")).toMatchObject({ resent: true });
    const after = await live();
    expect(after).toEqual([expect.objectContaining({ supplierId: cj.id, status: "placed", backupForSupplierId: f.products.projector.supplierId })]);
    expect(after[0]!.supplierOrderRef).not.toBe(before.supplierOrderRef);
    expect((await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!.fulfillmentStatus).toBe("sent_to_supplier");
  });
});
