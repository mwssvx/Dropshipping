// Restock orders. For the stock a store keeps itself (not from a dropshipping supplier), the
// merchant writes down what they ordered from their own supplier: which options, how many, and what
// each costs. When the parcel comes they receive it, all at once or a part at a time, and it goes
// on the stock count, in the stock history, and the cost they paid becomes the option's cost.
// What's still on the way shows on the product page.
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { receiveStock } from "./own-stock";

export const MAX_RESTOCK_LINES = 200;
export const MAX_RESTOCK_QUANTITY = 100_000;

export type RestockLineInput = { variantId: string; quantity: number; unitCostMinor?: number | null };

/** The options a restock order can be for: the store's own stock, not supplier or gift card products. */
export async function restockChoices(db: Db, shopId: string) {
  const rows = await db
    .select({ variantId: schema.variants.id, option: schema.variants.title, sku: schema.variants.sku, barcode: schema.variants.barcode, stock: schema.variants.stock, costMinor: schema.variants.costMinor, productId: schema.products.id, product: schema.products.title })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(eq(schema.products.shopId, shopId), isNull(schema.products.sourceUrl), isNull(schema.products.supplierId), eq(schema.products.giftCard, false)))
    .orderBy(asc(schema.products.title), asc(schema.variants.position));
  return rows.map((r) => ({ ...r, title: lineTitle(r.product, r.option) }));
}

const isId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

const lineTitle = (product: string, option: string) => (option === "Default" ? product : `${product} (${option})`);

/** Writes down a new restock order. */
export async function createRestockOrder(
  db: Db,
  shopId: string,
  input: { supplierName: string; expectedOn?: string | null; note?: string | null; lines: RestockLineInput[] },
) {
  const supplierName = input.supplierName.trim();
  if (!supplierName) throw new UserError("Say who you're ordering from.");
  if (supplierName.length > 100) throw new UserError("Keep the supplier's name under 100 characters.");
  const note = (input.note ?? "").trim() || null;
  if (note && note.length > 1000) throw new UserError("Keep the note under 1,000 characters.");
  const expectedOn = (input.expectedOn ?? "").trim() || null;
  if (expectedOn && (!/^\d{4}-\d{2}-\d{2}$/.test(expectedOn) || Number.isNaN(Date.parse(expectedOn)))) throw new UserError("Pick the date it should arrive, or leave it empty.");
  const lines = input.lines.filter((l) => l.quantity !== 0);
  if (!lines.length) throw new UserError("Add how many of at least one option you're ordering.");
  if (lines.length > MAX_RESTOCK_LINES) throw new UserError(`One restock order can have up to ${MAX_RESTOCK_LINES} options.`);
  if (new Set(lines.map((l) => l.variantId)).size !== lines.length) throw new UserError("Each option can only be on the order once.");
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_RESTOCK_QUANTITY) throw new UserError("Order whole numbers from 1 to 100,000.");
    if (l.unitCostMinor != null && (!Number.isInteger(l.unitCostMinor) || l.unitCostMinor < 0)) throw new UserError("Enter costs like 4.50, or leave them empty.");
  }
  const choices = new Map((await restockChoices(db, shopId)).map((c) => [c.variantId, c]));
  const missing = lines.find((l) => !choices.has(l.variantId));
  if (missing) throw new UserError("Restock orders are for the stock you keep yourself. Supplier products restock on their own.");
  return db.transaction(async (tx) => {
    // Numbered per store under a lock, so two at once don't get the same number.
    await tx.execute(sql`select 1 from ${schema.shops} where ${schema.shops.id} = ${shopId} for update`);
    const [last] = await tx.select({ n: sql<number>`coalesce(max(${schema.restockOrders.number}), 0)` }).from(schema.restockOrders).where(eq(schema.restockOrders.shopId, shopId));
    const [order] = await tx
      .insert(schema.restockOrders)
      .values({ shopId, number: Number(last?.n ?? 0) + 1, supplierName, note, expectedOn })
      .returning();
    await tx.insert(schema.restockLines).values(
      lines.map((l, position) => ({
        restockOrderId: order!.id,
        variantId: l.variantId,
        title: choices.get(l.variantId)!.title,
        quantity: l.quantity,
        unitCostMinor: l.unitCostMinor ?? null,
        position,
      })),
    );
    return order!;
  });
}

export type RestockLine = typeof schema.restockLines.$inferSelect & { productId: string | null };

/** One restock order with its lines and what's still to come. */
export async function getRestockOrder(db: Db, shopId: string, id: string) {
  if (!isId(id)) throw new NotFoundError("Restock order");
  const order = await db.query.restockOrders.findFirst({ where: and(eq(schema.restockOrders.id, id), eq(schema.restockOrders.shopId, shopId)) });
  if (!order) throw new NotFoundError("Restock order");
  const rows = await db
    .select({ line: schema.restockLines, productId: schema.variants.productId })
    .from(schema.restockLines)
    .leftJoin(schema.variants, eq(schema.variants.id, schema.restockLines.variantId))
    .where(eq(schema.restockLines.restockOrderId, order.id))
    .orderBy(asc(schema.restockLines.position));
  const lines: RestockLine[] = rows.map((r) => ({ ...r.line, productId: r.productId }));
  return { ...order, lines, ...totals(lines) };
}

function totals(lines: { quantity: number; receivedQuantity: number; unitCostMinor: number | null }[]) {
  return {
    ordered: lines.reduce((s, l) => s + l.quantity, 0),
    received: lines.reduce((s, l) => s + l.receivedQuantity, 0),
    /** What the order costs, from the lines with a cost. */
    costMinor: lines.reduce((s, l) => s + (l.unitCostMinor ?? 0) * l.quantity, 0),
  };
}

/** The store's restock orders, open ones first, then newest. */
export async function listRestockOrders(db: Db, shopId: string) {
  const orders = await db.query.restockOrders.findMany({
    where: eq(schema.restockOrders.shopId, shopId),
    orderBy: [sql`case when ${schema.restockOrders.status} = 'open' then 0 else 1 end`, desc(schema.restockOrders.number)],
    limit: 200,
  });
  if (!orders.length) return [];
  const lines = await db.query.restockLines.findMany({ where: inArray(schema.restockLines.restockOrderId, orders.map((o) => o.id)) });
  return orders.map((o) => {
    const own = lines.filter((l) => l.restockOrderId === o.id);
    return { ...o, lines: own.length, ...totals(own) };
  });
}

/**
 * Some or all of a restock order arrived: each line gets the quantity given (all that's still to
 * come when none is given), capped at what was ordered. The order is done once every line is in.
 */
export async function receiveRestock(db: Db, shopId: string, id: string, received?: { lineId: string; quantity: number }[]) {
  if (!isId(id)) throw new NotFoundError("Restock order");
  return db.transaction(async (tx) => {
    // Locked first, so receiving twice at once doesn't add the stock twice.
    await tx.execute(sql`select 1 from ${schema.restockOrders} where ${schema.restockOrders.id} = ${id} for update`);
    const order = await tx.query.restockOrders.findFirst({ where: and(eq(schema.restockOrders.id, id), eq(schema.restockOrders.shopId, shopId)) });
    if (!order) throw new NotFoundError("Restock order");
    if (order.status !== "open") throw new UserError(order.status === "received" ? "Everything on this order already arrived." : "This order was cancelled.");
    const lines = await tx.query.restockLines.findMany({ where: eq(schema.restockLines.restockOrderId, order.id), orderBy: asc(schema.restockLines.position) });
    const wanted = new Map((received ?? lines.map((l) => ({ lineId: l.id, quantity: l.quantity - l.receivedQuantity }))).map((r) => [r.lineId, r.quantity]));
    for (const n of wanted.values()) if (!Number.isInteger(n) || n < 0) throw new UserError("Enter what arrived as whole numbers.");
    let added = 0;
    for (const l of lines) {
      const n = Math.min(wanted.get(l.id) ?? 0, l.quantity - l.receivedQuantity);
      if (n <= 0) continue;
      await tx.update(schema.restockLines).set({ receivedQuantity: l.receivedQuantity + n }).where(eq(schema.restockLines.id, l.id));
      l.receivedQuantity += n;
      added += n;
      if (!l.variantId) continue;
      await receiveStock(tx as unknown as Db, l.variantId, n, order.id);
      if (l.unitCostMinor !== null) await tx.update(schema.variants).set({ costMinor: l.unitCostMinor }).where(eq(schema.variants.id, l.variantId));
    }
    if (!added) throw new UserError("Enter how many of something arrived.");
    const done = lines.every((l) => l.receivedQuantity >= l.quantity);
    if (done) await tx.update(schema.restockOrders).set({ status: "received", receivedAt: new Date() }).where(eq(schema.restockOrders.id, order.id));
    return { added, done };
  });
}

/** Nothing more is coming. What already arrived stays on the shelf. */
export async function cancelRestockOrder(db: Db, shopId: string, id: string) {
  const [order] = await db
    .update(schema.restockOrders)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(and(eq(schema.restockOrders.id, id), eq(schema.restockOrders.shopId, shopId), eq(schema.restockOrders.status, "open")))
    .returning({ id: schema.restockOrders.id });
  if (!order) throw new UserError("Only an order still on the way can be cancelled.");
}

/** What's on the way for a product's options from open restock orders, by option. */
export async function incomingStock(db: Db, shopId: string, productId: string) {
  const rows = await db
    .select({
      variantId: schema.restockLines.variantId,
      quantity: schema.restockLines.quantity,
      receivedQuantity: schema.restockLines.receivedQuantity,
      restockId: schema.restockOrders.id,
      number: schema.restockOrders.number,
      expectedOn: schema.restockOrders.expectedOn,
    })
    .from(schema.restockLines)
    .innerJoin(schema.restockOrders, eq(schema.restockOrders.id, schema.restockLines.restockOrderId))
    .innerJoin(schema.variants, eq(schema.variants.id, schema.restockLines.variantId))
    .where(and(eq(schema.restockOrders.shopId, shopId), eq(schema.restockOrders.status, "open"), eq(schema.variants.productId, productId)))
    .orderBy(asc(schema.restockOrders.number));
  return rows
    .filter((r) => r.quantity > r.receivedQuantity)
    .map((r) => ({ variantId: r.variantId!, quantity: r.quantity - r.receivedQuantity, restock: { id: r.restockId, number: r.number, expectedOn: r.expectedOn } }));
}
