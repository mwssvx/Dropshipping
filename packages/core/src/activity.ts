// The team activity log: who did what on a store, newest first, for the owner to look back on.
// Entries are written by the admin after an action succeeds, in plain words ("Refunded $12.00 on
// order #1043"), with a link to what changed. Kept for a little over a year.
import { and, desc, eq, lt } from "drizzle-orm";
import { schema, type Db } from "@sf/db";

const DAY = 86_400_000;
export const ACTIVITY_KEEP_DAYS = 400;
const PAGE = 50;

export type ActivityActor = { shopId: string; userId: string; email: string };

/**
 * Notes something a team member did. With an order, "{order}" in the summary becomes its number
 * ("#1043") and the entry links to the order.
 */
export async function logActivity(db: Db, actor: ActivityActor, summary: string, opts: { orderId?: string; href?: string } = {}, now = new Date()) {
  let text = summary;
  let href = opts.href ?? null;
  if (opts.orderId) {
    const order = await db.query.orders.findFirst({
      where: and(eq(schema.orders.id, opts.orderId), eq(schema.orders.shopId, actor.shopId)),
      columns: { number: true },
    });
    text = text.replaceAll("{order}", order ? `#${order.number}` : "an order");
    href ??= `/admin/orders/${opts.orderId}`;
  }
  await db.insert(schema.activity).values({ shopId: actor.shopId, userId: actor.userId, email: actor.email, summary: text.slice(0, 500), href, createdAt: now });
}

/** A page of the log, newest first, optionally for one person; next is where the following page starts. */
export async function listActivity(db: Db, shopId: string, opts: { userId?: string; before?: Date } = {}) {
  const rows = await db.query.activity.findMany({
    where: and(
      eq(schema.activity.shopId, shopId),
      opts.userId ? eq(schema.activity.userId, opts.userId) : undefined,
      opts.before ? lt(schema.activity.createdAt, opts.before) : undefined,
    ),
    orderBy: desc(schema.activity.createdAt),
    limit: PAGE + 1,
  });
  const page = rows.slice(0, PAGE);
  return { entries: page, next: rows.length > PAGE ? page.at(-1)!.createdAt : null };
}

/** Drops entries older than the log keeps. Run by the scheduled job. */
export async function pruneActivity(db: Db, now = new Date()) {
  await db.delete(schema.activity).where(lt(schema.activity.createdAt, new Date(now.getTime() - ACTIVITY_KEEP_DAYS * DAY)));
}
