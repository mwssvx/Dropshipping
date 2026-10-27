// Pick list. Before packing, the merchant walks the shelf once with one list: each option of their
// own stock that the orders waiting to ship need, added up, with its SKU and barcode and the
// orders it goes in. Items a supplier ships are left off, since there's nothing to pick.
import { inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { ordersWaitingForTracking } from "./tracking-import";
import { MAX_PACKING_SLIPS } from "./packing-slips";

export type PickItem = { key: string; title: string; sku: string | null; barcode: string | null; location: string | null; quantity: number; stock: number | null; orders: number[] };

/** What to pick for the orders waiting to ship (the same ones the packing slips print), in shelf order. */
export async function pickList(db: Db, shopId: string) {
  const orders = (await ordersWaitingForTracking(db, shopId)).slice(0, MAX_PACKING_SLIPS);
  const numbers = new Map(orders.map((o) => [o.id, o.number]));
  const lines = orders.length ? await db.query.orderLines.findMany({ where: inArray(schema.orderLines.orderId, orders.map((o) => o.id)) }) : [];
  const variantIds = [...new Set(lines.map((l) => l.variantId).filter((v): v is string => !!v))];
  const rows = variantIds.length
    ? await db.query.variants.findMany({ where: inArray(schema.variants.id, variantIds), columns: { id: true, productId: true, sku: true, barcode: true, location: true, stock: true } })
    : [];
  const productIds = [...new Set(rows.map((r) => r.productId))];
  const products = productIds.length
    ? await db.query.products.findMany({ where: inArray(schema.products.id, productIds), columns: { id: true, sourceUrl: true, supplierId: true, giftCard: true } })
    : [];
  const own = new Set(products.filter((p) => !p.sourceUrl && !p.supplierId && !p.giftCard).map((p) => p.id));
  const variants = new Map(rows.map((r) => [r.id, r]));
  const items = new Map<string, PickItem>();
  let fromSuppliers = 0;
  for (const l of lines) {
    const v = l.variantId ? variants.get(l.variantId) : undefined;
    // A supplier's item isn't picked. An option deleted since the order was placed still is.
    if (v && !own.has(v.productId)) {
      fromSuppliers += l.quantity;
      continue;
    }
    const key = v?.id ?? `title:${l.title}`;
    const item = items.get(key) ?? { key, title: l.title, sku: v?.sku ?? null, barcode: v?.barcode ?? null, location: v?.location ?? null, quantity: 0, stock: v?.stock ?? null, orders: [] };
    item.quantity += l.quantity;
    const n = numbers.get(l.orderId)!;
    if (!item.orders.includes(n)) item.orders.push(n);
    items.set(key, item);
  }
  // In shelf order, so one walk picks everything; then by SKU, with the ones missing either last.
  const order = (a: string | null, b: string | null) => (a ?? "\uffff").localeCompare(b ?? "\uffff", "en", { numeric: true });
  const sorted = [...items.values()].sort((a, b) => order(a.location, b.location) || order(a.sku, b.sku) || a.title.localeCompare(b.title));
  for (const i of sorted) i.orders.sort((a, b) => a - b);
  return { items: sorted, orders: new Set(sorted.flatMap((i) => i.orders)).size, fromSuppliers };
}
