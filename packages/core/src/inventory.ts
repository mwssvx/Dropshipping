// The inventory page: every option of the stock a store keeps itself, with what's on the shelf,
// what's on the way from restock orders, what it's worth at cost and at its price, how fast it
// sold over the last 30 days and so roughly how many days it will last. Also as a spreadsheet.
import { and, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { formatMoney } from "./money";
import { csvCell } from "./payouts";

const DAYS = 30;

export type InventoryRow = {
  variantId: string;
  productId: string;
  title: string;
  sku: string | null;
  stock: number;
  /** Still to come on open restock orders. */
  incoming: number;
  costMinor: number | null;
  priceMinor: number;
  valueAtCostMinor: number | null;
  valueAtPriceMinor: number;
  /** Sold in the last 30 days, less what came back. */
  sold: number;
  /** About how many days the stock lasts at that pace; null when nothing sold. */
  daysLeft: number | null;
  /** At or under the store's running-low number. */
  low: boolean;
};

export async function inventoryReport(db: Db, shop: { id: string; restockAlertAt: number }, now = new Date()) {
  const variants = await db
    .select({ variant: schema.variants, product: schema.products.title })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(eq(schema.products.shopId, shop.id), isNull(schema.products.sourceUrl), isNull(schema.products.supplierId), eq(schema.products.giftCard, false), isNotNull(schema.variants.stock)));
  const ids = variants.map((v) => v.variant.id);
  const since = new Date(now.getTime() - DAYS * 86_400_000);
  const [moved, coming] = ids.length
    ? await Promise.all([
        db
          .select({ variantId: schema.stockMovements.variantId, change: sql<number>`sum(${schema.stockMovements.change})::int` })
          .from(schema.stockMovements)
          .where(and(inArray(schema.stockMovements.variantId, ids), inArray(schema.stockMovements.reason, ["sale", "returned", "swap_in", "swap_out"]), gte(schema.stockMovements.createdAt, since)))
          .groupBy(schema.stockMovements.variantId),
        db
          .select({ variantId: schema.restockLines.variantId, n: sql<number>`sum(${schema.restockLines.quantity} - ${schema.restockLines.receivedQuantity})::int` })
          .from(schema.restockLines)
          .innerJoin(schema.restockOrders, eq(schema.restockOrders.id, schema.restockLines.restockOrderId))
          .where(and(eq(schema.restockOrders.shopId, shop.id), eq(schema.restockOrders.status, "open"), inArray(schema.restockLines.variantId, ids)))
          .groupBy(schema.restockLines.variantId),
      ])
    : [[], []];
  const soldBy = new Map(moved.map((m) => [m.variantId, Math.max(0, -Number(m.change))]));
  const comingBy = new Map(coming.map((c) => [c.variantId!, Number(c.n)]));
  const rows: InventoryRow[] = variants.map(({ variant: v, product }) => {
    const stock = v.stock!;
    const sold = soldBy.get(v.id) ?? 0;
    return {
      variantId: v.id,
      productId: v.productId,
      title: v.title === "Default" ? product : `${product} (${v.title})`,
      sku: v.sku,
      stock,
      incoming: comingBy.get(v.id) ?? 0,
      costMinor: v.costMinor,
      priceMinor: v.priceMinor,
      valueAtCostMinor: v.costMinor === null ? null : v.costMinor * stock,
      valueAtPriceMinor: v.priceMinor * stock,
      sold,
      daysLeft: sold > 0 ? Math.floor(stock / (sold / DAYS)) : null,
      low: shop.restockAlertAt > 0 && stock <= shop.restockAlertAt,
    };
  });
  // Soonest to run out first, then the rest by what they're worth.
  rows.sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) || (b.valueAtCostMinor ?? 0) - (a.valueAtCostMinor ?? 0) || a.title.localeCompare(b.title));
  return {
    rows,
    totals: {
      units: rows.reduce((s, r) => s + r.stock, 0),
      incoming: rows.reduce((s, r) => s + r.incoming, 0),
      atCostMinor: rows.reduce((s, r) => s + (r.valueAtCostMinor ?? 0), 0),
      atPriceMinor: rows.reduce((s, r) => s + r.valueAtPriceMinor, 0),
      /** Options in stock without a cost, so the value at cost leaves them out. */
      missingCost: rows.filter((r) => r.costMinor === null && r.stock > 0).length,
    },
  };
}

/** The same as a spreadsheet, amounts in the store's currency. */
export async function inventoryCsv(db: Db, shop: { id: string; restockAlertAt: number; currency: string }, now = new Date()) {
  const { rows } = await inventoryReport(db, shop, now);
  const amount = (m: number | null) => (m === null ? null : formatMoney(m, shop.currency).replace(/[^\d.,-]/g, "").replace(/,/g, ""));
  const header = ["Option", "SKU", "In stock", "On the way", "Cost each", "Price", "Value at cost", "Value at price", `Sold in ${DAYS} days`, "Days left"];
  const lines = rows.map((r) => [r.title, r.sku, r.stock, r.incoming, amount(r.costMinor), amount(r.priceMinor), amount(r.valueAtCostMinor), amount(r.valueAtPriceMinor), r.sold, r.daysLeft]);
  return [header, ...lines].map((l) => l.map((c) => csvCell(c ?? null)).join(",")).join("\n") + "\n";
}
