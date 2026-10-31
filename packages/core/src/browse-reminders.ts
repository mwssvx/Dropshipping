// Browse reminders: a subscriber who looked at a product while signed in to their store account,
// and didn't buy it or start a checkout, gets one "Still thinking it over?" email a few hours later.
// Only for stores that turn it on, only to buyers who said yes to marketing, at most one a week.
import { and, count, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import type { Mailer } from "./email";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** How long after the look the email goes, and how old a look can be to still get one. */
export const BROWSE_AFTER_HOURS = 4;
const BROWSE_WINDOW = 3 * DAY;
const BROWSE_EVERY = 7 * DAY;
/** The utm_source on the email's link, so its sales show under Sales by source. */
export const BROWSE_SOURCE = "browse-reminder";
const PAID = ["paid", "partially_refunded", "refunded"] as const;

/** Remembers the product a signed-in subscriber is looking at, when the store sends browse reminders. */
export async function recordProductView(db: Db, shop: { id: string; browseReminders: boolean }, buyer: { id: string; acceptsMarketing: boolean } | null, productId: string, now = new Date()) {
  if (!shop.browseReminders || !buyer?.acceptsMarketing) return false;
  await db
    .update(schema.customers)
    .set({ lastViewedProductId: productId, lastViewedAt: now })
    .where(and(eq(schema.customers.id, buyer.id), eq(schema.customers.shopId, shop.id)));
  return true;
}

export async function setBrowseReminders(db: Db, shopId: string, on: boolean) {
  await db.update(schema.shops).set({ browseReminders: on, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
}

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || "there";

/** Sends the browse reminders that are due, across stores (or one store). */
export async function sendBrowseReminders(
  ctx: { db: Db; mailer: Mailer; storeAddress?: (shop: typeof schema.shops.$inferSelect) => string | Promise<string> },
  now = new Date(),
  scope: { shopId?: string; limit?: number } = {},
) {
  const { db } = ctx;
  if (!ctx.storeAddress) return { sent: 0 };
  const c = schema.customers;
  const due = await db
    .select({ customer: c, shop: schema.shops, product: schema.products })
    .from(c)
    .innerJoin(schema.shops, eq(schema.shops.id, c.shopId))
    .innerJoin(schema.products, eq(schema.products.id, c.lastViewedProductId))
    .where(
      and(
        eq(schema.shops.browseReminders, true),
        eq(schema.shops.status, "active"),
        scope.shopId ? eq(schema.shops.id, scope.shopId) : undefined,
        eq(c.acceptsMarketing, true),
        isNull(c.unsubscribedAt),
        isNotNull(c.lastViewedAt),
        lte(c.lastViewedAt, new Date(now.getTime() - BROWSE_AFTER_HOURS * HOUR)),
        gte(c.lastViewedAt, new Date(now.getTime() - BROWSE_WINDOW)),
        or(isNull(c.browseRemindedAt), lt(c.browseRemindedAt, new Date(now.getTime() - BROWSE_EVERY))),
        // Still on sale and not sold out.
        eq(schema.products.status, "active"),
        sql`exists (select 1 from ${schema.variants} v where v.product_id = ${schema.products.id} and (v.stock is null or v.stock > 0))`,
        // Nothing ordered or started at checkout since the look: those buyers decided, or the checkout reminder has them.
        sql`not exists (select 1 from ${schema.orders} o where o.shop_id = ${c.shopId} and lower(o.email) = lower(${c.email}) and o.created_at >= ${c.lastViewedAt} and o.payment_status <> 'failed')`,
      ),
    )
    .limit(scope.limit ?? 200);
  let sent = 0;
  for (const { customer, shop, product } of due) {
    // Claim first, so two runs at once can't send two.
    const [claimed] = await db
      .update(c)
      .set({ browseRemindedAt: now })
      .where(and(eq(c.id, customer.id), or(isNull(c.browseRemindedAt), lt(c.browseRemindedAt, new Date(now.getTime() - BROWSE_EVERY)))))
      .returning({ id: c.id });
    if (!claimed) continue;
    const base = await ctx.storeAddress(shop);
    const unsubscribe = `${base}/unsubscribe/${customer.emailToken}`;
    const link = `${base}/products/${product.handle}?utm_source=${BROWSE_SOURCE}`;
    await ctx.mailer.send({
      to: customer.email,
      subject: `Still thinking about the ${product.title}?`,
      text: [
        `Hi ${firstName(customer.name)},`,
        ``,
        `You were looking at the ${product.title} at ${shop.name}. It's still here if you'd like another look:`,
        ``,
        `${link}`,
        ``,
        `Questions about it? Just reply to this email.`,
        ``,
        "—",
        `${shop.name}${shop.mailingAddress ? ` · ${shop.mailingAddress.replace(/\s*\n\s*/g, ", ")}` : ""}`,
        `You're getting this because you said yes to emails from ${shop.name}.`,
        `Unsubscribe: ${unsubscribe}`,
      ].join("\n"),
      headers: { "List-Unsubscribe": `<${unsubscribe}/one-click>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    sent++;
  }
  return { sent };
}

/** Browse reminders in the last 30 days, and the paid orders and sales from their link. */
export async function browseReminderStats(db: Db, shopId: string, now = new Date()) {
  const since = new Date(now.getTime() - 30 * DAY);
  const [sent] = await db.select({ n: count() }).from(schema.customers).where(and(eq(schema.customers.shopId, shopId), gte(schema.customers.browseRemindedAt, since)));
  const [sold] = await db
    .select({ n: count(), sales: sql<number>`coalesce(sum(${schema.orders.totalMinor} - ${schema.orders.refundedMinor}), 0)::bigint` })
    .from(schema.orders)
    .where(and(eq(schema.orders.shopId, shopId), eq(schema.orders.visitSource, BROWSE_SOURCE), inArray(schema.orders.paymentStatus, [...PAID]), ne(schema.orders.source, "replacement"), gte(schema.orders.createdAt, since)));
  return { sent: Number(sent?.n ?? 0), orders: Number(sold?.n ?? 0), salesMinor: Number(sold?.sales ?? 0) };
}
