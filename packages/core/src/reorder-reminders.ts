// Reorder reminders. Coffee, vitamins, pet food and refills run out, and the buyer who's about to
// run out is the easiest sale a store has. A product can say how long it usually lasts; that many
// days after the order arrives, the buyer gets one email with a link straight back to it. Never for
// gifts (someone else has it), free replacements or repeat deliveries, never when they've already
// bought it again, and never to buyers who unsubscribed from the store.
import { and, eq, exists, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import type { FulfillmentContext } from "./fulfillment";

export const REORDER_DAYS_LOW = 7;
export const REORDER_DAYS_HIGH = 180;
/** Reminders more than this many days late are never sent, so turning it on doesn't email old buyers. */
const LOOKBACK_DAYS = 30;
const BATCH = 200;

/** Sets how many days a product usually lasts, or turns its reminder off with null. */
export async function setReorderDays(db: Db, shopId: string, productId: string, days: number | null) {
  if (days !== null && !(Number.isInteger(days) && days >= REORDER_DAYS_LOW && days <= REORDER_DAYS_HIGH)) {
    throw new UserError(`Pick ${REORDER_DAYS_LOW} to ${REORDER_DAYS_HIGH} days, or no reminder.`);
  }
  const [row] = await db
    .update(schema.products)
    .set({ reorderDays: days, updatedAt: new Date() })
    .where(and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)))
    .returning({ reorderDays: schema.products.reorderDays });
  if (!row) throw new NotFoundError("Product");
  return row;
}

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || "there";

/** Emails the reorder reminders that are due, for one store or all of them. Returns how many went out. */
export async function sendReorderReminders(ctx: FulfillmentContext, scope: { shopId?: string; limit?: number } = {}) {
  const { db } = ctx;
  const now = ctx.now?.() ?? new Date();
  const o = schema.orders;
  const p = schema.products;
  // Counted from when it arrived, or from payment when the courier never said.
  const since = sql`coalesce((select max(${schema.fulfillments.deliveredAt}) from ${schema.fulfillments} where ${schema.fulfillments.orderId} = ${o.id}), ${o.paidAt})`;
  const dueAt = sql`${since} + make_interval(days => ${p.reorderDays})`;
  const nowTs = sql`${now.toISOString()}::timestamptz`;
  const dueLine = and(isNotNull(p.reorderDays), sql`${dueAt} <= ${nowTs}`, sql`${dueAt} > ${nowTs} - make_interval(days => ${LOOKBACK_DAYS})`);
  const hasDueLine = exists(
    db
      .select({ one: sql`1` })
      .from(schema.orderLines)
      .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
      .innerJoin(p, eq(p.id, schema.variants.productId))
      .where(and(eq(schema.orderLines.orderId, o.id), dueLine)),
  );
  const due = await db
    .select({ order: o, shop: schema.shops })
    .from(o)
    .innerJoin(schema.shops, eq(schema.shops.id, o.shopId))
    .where(
      and(
        scope.shopId ? eq(o.shopId, scope.shopId) : undefined,
        eq(schema.shops.status, "active"),
        inArray(o.paymentStatus, ["paid", "partially_refunded"]),
        inArray(o.source, ["checkout", "payment_link", "post_purchase"]),
        isNull(o.gift),
        isNull(o.reorderRemindedAt),
        hasDueLine,
      ),
    )
    .orderBy(o.createdAt)
    .limit(scope.limit ?? BATCH);
  let sent = 0;
  for (const { order, shop } of due) {
    // Claim first, so two runs at once can't remind twice.
    const [claimed] = await db.update(o).set({ reorderRemindedAt: now }).where(and(eq(o.id, order.id), isNull(o.reorderRemindedAt))).returning({ id: o.id });
    if (!claimed || !order.email) continue;
    const customer = await db.query.customers.findFirst({ where: and(eq(schema.customers.shopId, shop.id), eq(schema.customers.email, order.email)) });
    if (customer?.unsubscribedAt) continue;
    const products = await db
      .selectDistinct({ id: p.id, title: p.title, handle: p.handle })
      .from(schema.orderLines)
      .innerJoin(o, eq(o.id, schema.orderLines.orderId))
      .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
      .innerJoin(p, eq(p.id, schema.variants.productId))
      .where(and(eq(schema.orderLines.orderId, order.id), eq(p.status, "active"), dueLine));
    // Anything they've bought again since (by hand or on a subscription) is left out.
    const again = products.length
      ? await db
          .selectDistinct({ id: schema.variants.productId })
          .from(schema.orderLines)
          .innerJoin(o, eq(o.id, schema.orderLines.orderId))
          .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
          .where(
            and(
              eq(o.shopId, shop.id),
              eq(o.email, order.email),
              gt(o.createdAt, order.createdAt),
              inArray(o.paymentStatus, ["paid", "partially_refunded"]),
              inArray(schema.variants.productId, products.map((x) => x.id)),
            ),
          )
      : [];
    const items = products.filter((x) => !again.some((a) => a.id === x.id));
    if (!items.length) continue;
    const base = ctx.storeAddress ? await ctx.storeAddress(shop) : new URL(await ctx.orderStatusUrl(shop, order)).origin;
    const unsubscribe = customer ? `${base}/unsubscribe/${customer.emailToken}` : null;
    const what = items.length === 1 ? items[0]!.title : "a few things";
    await ctx.mailer.send({
      to: order.email,
      subject: items.length === 1 ? `Running low on ${what}?` : `Running low on what you got from ${shop.name}?`,
      text: [
        `Hi ${firstName(order.shippingAddress?.name)},`,
        ``,
        `It's been a while since your order #${order.number} from ${shop.name} arrived, so you may be running low on ${what}. Here's a quick way back to ${items.length === 1 ? "it" : "them"}:`,
        ``,
        ...items.slice(0, 5).map((i) => `- ${i.title}: ${base}/products/${i.handle}`),
        ``,
        `Still have plenty? No need to do anything. This is the only reminder for this order.`,
        ...(unsubscribe ? [``, "—", `${shop.name}. Don't want these? Unsubscribe: ${unsubscribe}`] : []),
      ].join("\n"),
      ...(unsubscribe ? { headers: { "List-Unsubscribe": `<${unsubscribe}/one-click>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
    });
    sent++;
  }
  return { sent };
}
