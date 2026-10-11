// Pre-orders: the merchant lets buyers order a product's sold-out options, promised to ship by a
// date. Those orders wait (they're not sent to the supplier) until the stock check sees the option
// back in stock, then go out like any other. If the date passes first, the merchant is told once.
import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { schema, type Db, type Preorder } from "@sf/db";
import { z } from "zod";
import type { Mailer } from "./email";
import { NotFoundError, UserError } from "./errors";
import { can } from "./team";

type Product = typeof schema.products.$inferSelect;

const DAY = 86_400_000;
export const PREORDER_MAX_DAYS = 120;
const PAID = ["paid", "partially_refunded"] as const;

const preorderSchema = z.object({
  shipsBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date it will ship by."),
  limit: z.number().int().min(1, "Allow at least 1 pre-order, or leave the limit empty.").max(10_000).nullable().default(null),
});

/** End of the promised day, UTC: what checks and emails compare with. */
export const preorderDeadline = (p: Preorder) => new Date(`${p.shipsBy}T23:59:59.999Z`);

/** Turns pre-orders on for a product with a ship-by date (tomorrow to 120 days out), or off with null. */
export async function setPreorder(db: Db, shopId: string, productId: string, input: z.input<typeof preorderSchema> | null, now = new Date()) {
  let preorder: Preorder | null = null;
  if (input) {
    const parsed = preorderSchema.safeParse(input);
    if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
    const deadline = preorderDeadline(parsed.data);
    if (Number.isNaN(deadline.getTime())) throw new UserError("Pick the date it will ship by.");
    if (deadline.getTime() < now.getTime() + DAY) throw new UserError("Pick a ship-by date from tomorrow on.");
    if (deadline.getTime() > now.getTime() + PREORDER_MAX_DAYS * DAY) throw new UserError(`Pre-orders can promise up to ${PREORDER_MAX_DAYS} days ahead.`);
    preorder = parsed.data;
  }
  const [row] = await db
    .update(schema.products)
    .set({ preorder, updatedAt: new Date() })
    .where(and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)))
    .returning({ id: schema.products.id });
  if (!row) throw new NotFoundError("Product");
  return preorder;
}

/** How many of a product have been pre-ordered on paid orders, for the limit. */
export async function preordersSold(db: Db, productId: string) {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${schema.orderLines.quantity}), 0)::int` })
    .from(schema.orderLines)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
    .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .where(and(eq(schema.variants.productId, productId), eq(schema.orderLines.preorder, true), inArray(schema.orders.paymentStatus, [...PAID])));
  return Number(row?.n ?? 0);
}

/** The product's pre-order terms while they still apply (the date hasn't passed), else null. */
export function openPreorder(product: Pick<Product, "preorder">, now = new Date()) {
  return product.preorder && preorderDeadline(product.preorder) > now ? product.preorder : null;
}

/** "Nov 20, 2026", for the store, emails and the admin. */
export function formatShipsBy(date: Date | string) {
  const d = typeof date === "string" ? new Date(`${date}T12:00:00Z`) : date;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * Pre-ordered options that are still sold out on this order. The order waits while any are;
 * an option with no stock count (sold without limit) never holds it.
 */
export async function preorderWaitingOn(db: Db, orderId: string) {
  const rows = await db
    .select({ title: schema.orderLines.title })
    .from(schema.orderLines)
    .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .where(and(eq(schema.orderLines.orderId, orderId), eq(schema.orderLines.preorder, true), isNotNull(schema.variants.stock), sql`${schema.variants.stock} <= 0`));
  return rows.map((r) => r.title);
}

/** Once a day: tell the team about pre-orders past their ship-by date and still waiting. */
export async function notifyLatePreorders(ctx: { db: Db; mailer: Mailer; adminUrl: (path: string) => string }, opts: { shopId?: string; now?: Date } = {}) {
  const { db } = ctx;
  const now = opts.now ?? new Date();
  const late = await db.query.orders.findMany({
    where: and(
      isNotNull(schema.orders.preorderShipsBy),
      lt(schema.orders.preorderShipsBy, now),
      isNull(schema.orders.preorderLateAt),
      eq(schema.orders.paymentStatus, "paid"),
      eq(schema.orders.fulfillmentStatus, "unfulfilled"),
      opts.shopId ? eq(schema.orders.shopId, opts.shopId) : undefined,
    ),
    limit: 200,
  });
  let sent = 0;
  for (const order of late) {
    const [claimed] = await db
      .update(schema.orders)
      .set({ preorderLateAt: now })
      .where(and(eq(schema.orders.id, order.id), isNull(schema.orders.preorderLateAt)))
      .returning({ id: schema.orders.id });
    if (!claimed) continue;
    const waiting = await preorderWaitingOn(db, order.id);
    if (!waiting.length) continue;
    const shop = (await db.query.shops.findFirst({ where: eq(schema.shops.id, order.shopId) }))!;
    const people = await db
      .select({ email: schema.users.email, role: schema.shopMembers.role })
      .from(schema.shopMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.shopMembers.userId))
      .where(eq(schema.shopMembers.shopId, order.shopId));
    for (const p of people.filter((x) => can(x.role, "orders"))) {
      await ctx.mailer.send({
        to: p.email,
        subject: `Pre-order #${order.number} at ${shop.name} is past its ship-by date`,
        text: [
          `Hi,`,
          ``,
          `Order #${order.number} was a pre-order promised to ship by ${formatShipsBy(order.preorderShipsBy!)}. It's still waiting for ${waiting.join(", ")} to be back in stock at the supplier.`,
          ``,
          `Let the buyer know what's happening, offer a refund, or source it elsewhere and add tracking:`,
          ctx.adminUrl(`/admin/orders/${order.id}`),
        ].join("\n"),
      });
      sent++;
    }
  }
  return { sent };
}
