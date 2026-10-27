// The store's own stock goes down as it sells. Products the merchant added by hand keep their own
// count (imported products read theirs from the supplier every day instead). It comes off when an
// order is paid, goes back when a paid order is cancelled or fully refunded before anything has
// shipped, and follows a swap from one option to another before it ships. Pre-ordered lines were
// sold past the stock, so they don't take any, and stock never goes below 0. An option with no
// count ("Not tracked") is left alone. The team is emailed once when an option runs low.
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import type { Mailer } from "./email";
import { UserError } from "./errors";
import { can } from "./team";

/** Of these options, the ones counting the store's own stock. */
async function ownStockVariants(db: Db, variantIds: string[]) {
  if (!variantIds.length) return new Set<string>();
  const rows = await db
    .select({ id: schema.variants.id })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(inArray(schema.variants.id, variantIds), isNotNull(schema.variants.stock), isNull(schema.products.sourceUrl)));
  return new Set(rows.map((r) => r.id));
}

/** How many of each own-stock option the order holds. */
async function orderStock(db: Db, orderId: string) {
  const lines = await db.query.orderLines.findMany({ where: and(eq(schema.orderLines.orderId, orderId), eq(schema.orderLines.preorder, false)) });
  const own = await ownStockVariants(db, [...new Set(lines.map((l) => l.variantId).filter((v): v is string => !!v))]);
  const qty = new Map<string, number>();
  for (const l of lines) if (l.variantId && own.has(l.variantId)) qty.set(l.variantId, (qty.get(l.variantId) ?? 0) + l.quantity);
  return qty;
}

type Reason = (typeof schema.stockMovements.$inferInsert)["reason"];

/** Moves an option's count by this much (never below 0) and writes down why. */
async function change(db: Db, variantId: string, by: number, why: { reason: Reason; orderId: string | null }) {
  const before = await db.query.variants.findFirst({ where: eq(schema.variants.id, variantId), columns: { stock: true } });
  const [after] = await db
    .update(schema.variants)
    .set({ stock: sql`greatest(${schema.variants.stock} + ${by}, 0)` })
    .where(and(eq(schema.variants.id, variantId), isNotNull(schema.variants.stock)))
    .returning({ stock: schema.variants.stock });
  if (!after || before?.stock == null || after.stock === before.stock) return;
  await recordMovement(db, variantId, { ...why, change: after.stock! - before.stock, stockAfter: after.stock });
}

/** Writes one line of an option's stock history. */
export async function recordMovement(db: Db, variantId: string, m: { reason: Reason; orderId?: string | null; restockOrderId?: string | null; change: number; stockAfter: number | null }) {
  const [v] = await db
    .select({ shopId: schema.products.shopId })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(eq(schema.variants.id, variantId));
  if (!v) return;
  await db.insert(schema.stockMovements).values({ shopId: v.shopId, variantId, orderId: m.orderId ?? null, restockOrderId: m.restockOrderId ?? null, reason: m.reason, change: m.change, stockAfter: m.stockAfter });
}

/**
 * Stock that arrived on a restock order goes on the shelf. An option that wasn't counted starts
 * counting from what arrived.
 */
export async function receiveStock(db: Db, variantId: string, n: number, restockOrderId: string) {
  const [after] = await db
    .update(schema.variants)
    .set({ stock: sql`coalesce(${schema.variants.stock}, 0) + ${n}` })
    .where(eq(schema.variants.id, variantId))
    .returning({ stock: schema.variants.stock });
  if (after) await recordMovement(db, variantId, { reason: "received", restockOrderId, change: n, stockAfter: after.stock });
}

/** A paid order takes its items off the store's own stock, once. */
export async function takeOrderStock(db: Db, orderId: string, at = new Date()) {
  const [claimed] = await db
    .update(schema.orders)
    .set({ stockTakenAt: at })
    .where(and(eq(schema.orders.id, orderId), isNull(schema.orders.stockTakenAt)))
    .returning({ id: schema.orders.id });
  if (!claimed) return 0;
  const qty = await orderStock(db, orderId);
  for (const [variantId, n] of qty) await change(db, variantId, -n, { reason: "sale", orderId });
  return qty.size;
}

/** Nothing on the order will ship: its items go back on the shelf, once. */
export async function returnOrderStock(db: Db, orderId: string) {
  const [claimed] = await db
    .update(schema.orders)
    .set({ stockTakenAt: null })
    .where(and(eq(schema.orders.id, orderId), isNotNull(schema.orders.stockTakenAt)))
    .returning({ id: schema.orders.id });
  if (!claimed) return 0;
  const qty = await orderStock(db, orderId);
  for (const [variantId, n] of qty) await change(db, variantId, n, { reason: "returned", orderId });
  return qty.size;
}

/** A line of an order that took stock changed option: the old one goes back, the new one comes off. */
export async function moveLineStock(db: Db, order: { id: string; stockTakenAt: Date | null }, line: { preorder: boolean; quantity: number }, from: string | null, to: string) {
  if (!order.stockTakenAt || line.preorder) return;
  const own = await ownStockVariants(db, [from, to].filter((v): v is string => !!v));
  if (from && own.has(from)) await change(db, from, line.quantity, { reason: "swap_out", orderId: order.id });
  if (own.has(to)) await change(db, to, -line.quantity, { reason: "swap_in", orderId: order.id });
}

/**
 * The merchant typed new counts for a product's options (the product form, the app, bulk edits):
 * each one that changed on the store's own stock goes in its history.
 */
export async function recordStockEdits(db: Db, productId: string, before: Map<string, number | null>) {
  const product = await db.query.products.findFirst({ where: eq(schema.products.id, productId), columns: { sourceUrl: true } });
  if (!product || product.sourceUrl) return;
  const now = await db.query.variants.findMany({ where: eq(schema.variants.productId, productId), columns: { id: true, stock: true } });
  for (const v of now) {
    const was = before.has(v.id) ? before.get(v.id)! : undefined;
    if (was === undefined) {
      if (v.stock !== null) await recordMovement(db, v.id, { reason: "start", change: v.stock, stockAfter: v.stock });
    } else if (was !== v.stock) {
      await recordMovement(db, v.id, { reason: "edit", change: (v.stock ?? 0) - (was ?? 0), stockAfter: v.stock });
    }
  }
}

export type StockMovement = {
  id: string;
  at: Date;
  option: string;
  reason: Reason;
  change: number;
  stockAfter: number | null;
  order: { id: string; number: number } | null;
  restock: { id: string; number: number } | null;
};

/** A product's stock history, newest first. */
export async function stockHistory(db: Db, shopId: string, productId: string, limit = 50): Promise<StockMovement[]> {
  const rows = await db
    .select({ m: schema.stockMovements, option: schema.variants.title, orderNumber: schema.orders.number, restockNumber: schema.restockOrders.number })
    .from(schema.stockMovements)
    .innerJoin(schema.variants, eq(schema.variants.id, schema.stockMovements.variantId))
    .leftJoin(schema.orders, eq(schema.orders.id, schema.stockMovements.orderId))
    .leftJoin(schema.restockOrders, eq(schema.restockOrders.id, schema.stockMovements.restockOrderId))
    .where(and(eq(schema.stockMovements.shopId, shopId), eq(schema.variants.productId, productId)))
    .orderBy(desc(schema.stockMovements.seq))
    .limit(limit);
  return rows.map(({ m, option, orderNumber, restockNumber }) => ({
    id: m.id,
    at: m.createdAt,
    option,
    reason: m.reason,
    change: m.change,
    stockAfter: m.stockAfter,
    order: m.orderId && orderNumber !== null ? { id: m.orderId, number: orderNumber } : null,
    restock: m.restockOrderId && restockNumber !== null ? { id: m.restockOrderId, number: restockNumber } : null,
  }));
}

/** The most the running-low email can be set to. */
export const RESTOCK_ALERT_MAX = 1000;

/** The team hears when an option has this many or fewer left; 0 turns it off. */
export async function setRestockAlert(db: Db, shopId: string, n: number) {
  if (!Number.isInteger(n) || n < 0 || n > RESTOCK_ALERT_MAX) throw new UserError(`Pick a number from 0 to ${RESTOCK_ALERT_MAX}. 0 turns the email off.`);
  await db.update(schema.shops).set({ restockAlertAt: n, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  // Options already told about are told again under the new number if they're still low.
  await db
    .update(schema.variants)
    .set({ lowStockNotifiedAt: null })
    .where(and(isNotNull(schema.variants.lowStockNotifiedAt), inArray(schema.variants.productId, db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.shopId, shopId)))));
  return n;
}

export type RunningLow = { variantId: string; productId: string; title: string; stock: number };

/** Options of stores' own products on sale at or under the store's number, fewest first. */
function lowOptions(db: Db, shopId?: string) {
  return db
    .select({
      variantId: schema.variants.id,
      productId: schema.products.id,
      shopId: schema.products.shopId,
      product: schema.products.title,
      option: schema.variants.title,
      stock: schema.variants.stock,
      notifiedAt: schema.variants.lowStockNotifiedAt,
    })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .innerJoin(schema.shops, eq(schema.shops.id, schema.products.shopId))
    .where(
      and(
        shopId ? eq(schema.shops.id, shopId) : undefined,
        sql`${schema.shops.restockAlertAt} > 0`,
        eq(schema.products.status, "active"),
        eq(schema.products.giftCard, false),
        isNull(schema.products.sourceUrl),
        isNotNull(schema.variants.stock),
        lte(schema.variants.stock, schema.shops.restockAlertAt),
      ),
    )
    .orderBy(asc(schema.variants.stock), asc(schema.products.title), asc(schema.variants.position));
}

const label = (product: string, option: string) => (option === "Default" ? product : `${product} – ${option}`);

/** For the Products page: the store's own options running low right now. */
export async function runningLow(db: Db, shopId: string): Promise<RunningLow[]> {
  return (await lowOptions(db, shopId)).map((r) => ({ variantId: r.variantId, productId: r.productId, title: label(r.product, r.option), stock: r.stock! }));
}

const LISTED = 20;

/**
 * From the scheduled job: restocked options get ready to be told about again, and each store with
 * options newly at or under its number emails the people who look after products, once per option.
 */
export async function notifyLowStock(ctx: { db: Db; mailer: Mailer; adminUrl: (path: string) => string }, opts: { shopId?: string; now?: Date } = {}) {
  const { db } = ctx;
  const now = opts.now ?? new Date();
  // Restocked above the number, or the option stopped counting: ready to be told about again.
  const cleared = await db
    .update(schema.variants)
    .set({ lowStockNotifiedAt: null })
    .where(
      and(
        isNotNull(schema.variants.lowStockNotifiedAt),
        sql`(${schema.variants.stock} is null or ${schema.variants.stock} > (select s.restock_alert_at from ${schema.products} p join ${schema.shops} s on s.id = p.shop_id where p.id = ${schema.variants.productId}))`,
        opts.shopId ? inArray(schema.variants.productId, db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.shopId, opts.shopId))) : undefined,
      ),
    )
    .returning({ id: schema.variants.id });
  const fresh = (await lowOptions(db, opts.shopId)).filter((r) => !r.notifiedAt);
  let sent = 0;
  for (const shopId of new Set(fresh.map((r) => r.shopId))) {
    const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
    if (!shop || shop.status !== "active") continue;
    const claimed = new Set(
      (
        await db
          .update(schema.variants)
          .set({ lowStockNotifiedAt: now })
          .where(and(inArray(schema.variants.id, fresh.filter((r) => r.shopId === shopId).map((r) => r.variantId)), isNull(schema.variants.lowStockNotifiedAt)))
          .returning({ id: schema.variants.id })
      ).map((r) => r.id),
    );
    const mine = fresh.filter((r) => claimed.has(r.variantId));
    if (!mine.length) continue;
    const people = await db
      .select({ email: schema.users.email, role: schema.shopMembers.role })
      .from(schema.shopMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.shopMembers.userId))
      .where(eq(schema.shopMembers.shopId, shop.id));
    const one = mine.length === 1;
    const out = mine.filter((r) => r.stock === 0).length;
    const subject = one
      ? `${label(mine[0]!.product, mine[0]!.option)} is ${mine[0]!.stock === 0 ? "sold out" : "running low"} (${shop.name})`
      : `${mine.length} options are running low (${shop.name})`;
    const text = [
      `Hi,`,
      ``,
      `${one ? "This option of your own stock is" : "These options of your own stock are"} at ${shop.restockAlertAt} or fewer${out ? `, and ${out === mine.length ? (one ? "it's" : "they're") : `${out} of them are`} sold out` : ""}:`,
      ``,
      ...mine.slice(0, LISTED).map((r) => `  ${label(r.product, r.option)}: ${r.stock === 0 ? "sold out" : `${r.stock} left`}. ${ctx.adminUrl(`/admin/products/${r.productId}`)}`),
      ...(mine.length > LISTED ? [`  and ${mine.length - LISTED} more: ${ctx.adminUrl("/admin/products#running-low")}`] : []),
      ``,
      `Restock and enter the new count on the product page. You can change the number or turn this email off on the Products page.`,
    ].join("\n");
    for (const p of people.filter((x) => can(x.role, "products"))) {
      await ctx.mailer.send({ to: p.email, subject, text });
      sent++;
    }
  }
  return { sent, back: cleared.length };
}
