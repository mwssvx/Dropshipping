import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";

type Shop = typeof schema.shops.$inferSelect;
type Notice = typeof schema.storeNotices.$inferSelect;
export type NoticeReason = Notice["reason"];

const DAY = 86_400_000;

/*
 * Trust, both ways. Merchants get the opposite of a sudden shutdown: every problem comes as a
 * warning first, with the reason, what to fix and a deadline; a pause always says why and can be
 * appealed. Buyers get a verified badge that means something specific and is shown in public.
 */

export const NOTICE_REASONS: Record<NoticeReason, { title: string; whatToDo: string; pauseWithoutWarning: boolean }> = {
  late_shipping: {
    title: "Orders are shipping late",
    whatToDo: "Ship or refund the late orders, and switch suppliers for items that keep running late.",
    pauseWithoutWarning: false,
  },
  high_refunds: {
    title: "Many orders are being refunded",
    whatToDo: "Check the refunded products' quality and listings. Remove items buyers keep returning.",
    pauseWithoutWarning: false,
  },
  chargebacks: {
    title: "Buyers are disputing payments with their banks",
    whatToDo: "Answer each dispute with tracking and delivery proof, and make your returns policy easy to find.",
    pauseWithoutWarning: false,
  },
  customer_complaints: {
    title: "Buyers have complained about this store",
    whatToDo: "Reply to the buyers who wrote in and fix what they reported. Tell us what you changed.",
    pauseWithoutWarning: false,
  },
  misleading_listing: {
    title: "A listing doesn't match what buyers receive",
    whatToDo: "Update the photos and description so they match the real item, or take the listing down.",
    pauseWithoutWarning: false,
  },
  prohibited_product: {
    title: "A product isn't allowed",
    whatToDo: "Remove the product. If you think it's allowed, appeal and tell us why.",
    pauseWithoutWarning: true,
  },
  identity: {
    title: "We couldn't confirm who runs this store",
    whatToDo: "Finish the identity check on the Money page.",
    pauseWithoutWarning: true,
  },
  other: { title: "Something needs your attention", whatToDo: "Follow the steps in the message, then reply with an appeal if anything's unclear.", pauseWithoutWarning: false },
};

/**
 * Send a notice. A warning doesn't stop sales. A pause needs an earlier warning for the same
 * reason (except illegal products and identity), so no store is shut down out of the blue.
 */
export async function sendNotice(
  db: Db,
  input: {
    shopId: string;
    kind: Notice["kind"];
    reason: NoticeReason;
    explanation: string;
    whatToDo?: string;
    dueBy?: Date | null;
    by: string;
  },
  now = new Date(),
) {
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, input.shopId) });
  if (!shop) throw new NotFoundError("Store");
  const reason = NOTICE_REASONS[input.reason];
  if (!reason) throw new UserError("Choose a reason.");
  const explanation = input.explanation.trim();
  if (explanation.length < 20) throw new UserError("Explain what happened in at least a sentence; the merchant sees exactly this.");

  if (input.kind === "paused" && !reason.pauseWithoutWarning) {
    const warned = await db.query.storeNotices.findFirst({
      where: and(eq(schema.storeNotices.shopId, shop.id), eq(schema.storeNotices.kind, "warning"), eq(schema.storeNotices.reason, input.reason)),
    });
    if (!warned) throw new UserError("Send a warning with a deadline first. Only illegal products and identity problems can be paused straight away.");
  }

  return db.transaction(async (tx) => {
    if (input.kind === "reinstated") {
      await tx.update(schema.storeNotices).set({ closedAt: now }).where(and(eq(schema.storeNotices.shopId, shop.id), isNull(schema.storeNotices.closedAt)));
    }
    const [notice] = await tx
      .insert(schema.storeNotices)
      .values({
        shopId: shop.id,
        kind: input.kind,
        reason: input.reason,
        explanation,
        whatToDo: input.whatToDo?.trim() || reason.whatToDo,
        dueBy: input.kind === "warning" ? (input.dueBy ?? new Date(now.getTime() + 7 * DAY)) : null,
        createdBy: input.by,
        // A reinstatement is good news with nothing to act on.
        closedAt: input.kind === "reinstated" ? now : null,
      })
      .returning();
    if (input.kind === "paused") {
      await tx.update(schema.shops).set({ status: "paused", statusReason: reason.title, verifiedAt: null, updatedAt: now }).where(eq(schema.shops.id, shop.id));
    } else if (input.kind === "reinstated") {
      await tx.update(schema.shops).set({ status: "active", statusReason: null, updatedAt: now }).where(eq(schema.shops.id, shop.id));
    }
    return notice!;
  });
}

/** Notices for the merchant, newest first, with their appeals. */
export async function listNotices(db: Db, shopId: string) {
  const notices = await db.query.storeNotices.findMany({ where: eq(schema.storeNotices.shopId, shopId), orderBy: desc(schema.storeNotices.createdAt) });
  const appeals = notices.length
    ? await db.query.appeals.findMany({ where: inArray(schema.appeals.noticeId, notices.map((n) => n.id)), orderBy: schema.appeals.createdAt })
    : [];
  return notices.map((n) => ({ ...n, title: NOTICE_REASONS[n.reason].title, appeals: appeals.filter((a) => a.noticeId === n.id) }));
}

/** Open notices that should show as a banner across the admin. */
export async function openNotices(db: Db, shopId: string) {
  return (await listNotices(db, shopId)).filter((n) => !n.closedAt);
}

export async function markNoticesRead(db: Db, shopId: string, now = new Date()) {
  await db.update(schema.storeNotices).set({ readAt: now }).where(and(eq(schema.storeNotices.shopId, shopId), isNull(schema.storeNotices.readAt)));
}

export async function submitAppeal(db: Db, shopId: string, noticeId: string, message: string) {
  const notice = await db.query.storeNotices.findFirst({ where: and(eq(schema.storeNotices.id, noticeId), eq(schema.storeNotices.shopId, shopId)) });
  if (!notice) throw new NotFoundError("Notice");
  if (notice.closedAt || notice.kind === "reinstated") throw new UserError("This notice is already closed.");
  const text = message.trim();
  if (text.length < 20) throw new UserError("Tell us what you changed or why you think this is wrong, in a sentence or two.");
  const [appeal] = await db
    .insert(schema.appeals)
    .values({ noticeId, shopId, message: text.slice(0, 4000) })
    .onConflictDoNothing()
    .returning();
  if (!appeal) throw new UserError("You already have an appeal waiting for a reply on this notice.");
  return appeal;
}

/** Staff decision. Accepting a pause's appeal reopens the store; accepting a warning's closes it. */
export async function decideAppeal(db: Db, appealId: string, input: { accept: boolean; response: string; by: string }, now = new Date()) {
  const response = input.response.trim();
  if (response.length < 10) throw new UserError("Write a reply the merchant can act on.");
  const appeal = await db.query.appeals.findFirst({ where: eq(schema.appeals.id, appealId) });
  if (!appeal) throw new NotFoundError("Appeal");
  if (appeal.status !== "open") throw new UserError("This appeal was already decided.");
  await db
    .update(schema.appeals)
    .set({ status: input.accept ? "accepted" : "rejected", response, decidedBy: input.by, decidedAt: now })
    .where(eq(schema.appeals.id, appeal.id));
  if (!input.accept) return { reinstated: false };
  const notice = (await db.query.storeNotices.findFirst({ where: eq(schema.storeNotices.id, appeal.noticeId) }))!;
  if (notice.kind === "paused") {
    await sendNotice(db, { shopId: appeal.shopId, kind: "reinstated", reason: notice.reason, explanation: `Your appeal was accepted: ${response}`, by: input.by }, now);
    return { reinstated: true };
  }
  await db.update(schema.storeNotices).set({ closedAt: now }).where(eq(schema.storeNotices.id, notice.id));
  return { reinstated: false };
}

export async function listOpenAppeals(db: Db) {
  return db
    .select({ appeal: schema.appeals, notice: schema.storeNotices, shop: { id: schema.shops.id, name: schema.shops.name, handle: schema.shops.handle, status: schema.shops.status } })
    .from(schema.appeals)
    .innerJoin(schema.storeNotices, eq(schema.storeNotices.id, schema.appeals.noticeId))
    .innerJoin(schema.shops, eq(schema.shops.id, schema.appeals.shopId))
    .where(eq(schema.appeals.status, "open"))
    .orderBy(schema.appeals.createdAt);
}

// Health --------------------------------------------------------------------------------------

export const HEALTH_LIMITS = { minOrders: 10, lateRate: 0.1, refundRate: 0.1 };
export const LATE_SHIP_DAYS = 7;

/** How the store has served buyers over the last 90 days. */
export async function storeHealth(db: Db, shopId: string, now = new Date()) {
  const since = new Date(now.getTime() - 90 * DAY);
  const o = schema.orders;
  const [orders] = await db
    .select({
      paid: sql<number>`count(*)::int`,
      refunded: sql<number>`count(*) filter (where ${o.refundedMinor} > 0)::int`,
      shipped: sql<number>`count(*) filter (where ${o.fulfillmentStatus} in ('shipped', 'delivered'))::int`,
    })
    .from(o)
    .where(and(eq(o.shopId, shopId), inArray(o.paymentStatus, ["paid", "partially_refunded", "refunded"]), gte(o.paidAt, since)));
  const f = schema.fulfillments;
  const [ship] = await db
    .select({
      shipped: sql<number>`count(*)::int`,
      onTime: sql<number>`count(*) filter (where ${f.shippedAt} - ${f.placedAt} <= ${`${LATE_SHIP_DAYS} days`}::interval)::int`,
    })
    .from(f)
    .where(and(eq(f.shopId, shopId), isNotNull(f.shippedAt), isNotNull(f.placedAt), gte(f.placedAt, since)));
  // Placed orders still not shipped after the limit count as late too.
  const [overdue] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(f)
    .where(and(eq(f.shopId, shopId), eq(f.status, "placed"), isNull(f.shippedAt), lte(f.placedAt, new Date(now.getTime() - LATE_SHIP_DAYS * DAY)), gte(f.placedAt, since)));
  const paid = Number(orders?.paid ?? 0);
  const shippedTotal = Number(ship?.shipped ?? 0) + Number(overdue?.n ?? 0);
  const onTimeRate = shippedTotal ? Number(ship?.onTime ?? 0) / shippedTotal : null;
  const refundRate = paid ? Number(orders?.refunded ?? 0) / paid : null;
  return {
    paidOrders: paid,
    shippedOrders: Number(orders?.shipped ?? 0),
    onTimeRate,
    refundRate,
    lateTooOften: paid >= HEALTH_LIMITS.minOrders && onTimeRate !== null && 1 - onTimeRate > HEALTH_LIMITS.lateRate,
    refundsTooOften: paid >= HEALTH_LIMITS.minOrders && refundRate !== null && refundRate > HEALTH_LIMITS.refundRate,
  };
}

/**
 * Daily check: a store that ships late or refunds too often gets a warning with a deadline,
 * at most once a month per reason. It never pauses anyone; people decide that.
 */
export async function runHealthChecks(db: Db, now = new Date()) {
  const shops = await db.query.shops.findMany({ where: eq(schema.shops.status, "active"), columns: { id: true } });
  let warned = 0;
  for (const { id } of shops) {
    const health = await storeHealth(db, id, now);
    const due: { reason: NoticeReason; explanation: string }[] = [];
    if (health.lateTooOften) {
      due.push({
        reason: "late_shipping",
        explanation: `Only ${Math.round(health.onTimeRate! * 100)}% of your orders in the last 90 days shipped within ${LATE_SHIP_DAYS} days of being placed. Buyers expect at least ${Math.round((1 - HEALTH_LIMITS.lateRate) * 100)}%.`,
      });
    }
    if (health.refundsTooOften) {
      due.push({
        reason: "high_refunds",
        explanation: `${Math.round(health.refundRate! * 100)}% of your orders in the last 90 days were refunded. Above ${Math.round(HEALTH_LIMITS.refundRate * 100)}% usually means a product or listing problem.`,
      });
    }
    for (const d of due) {
      const recent = await db.query.storeNotices.findFirst({
        where: and(eq(schema.storeNotices.shopId, id), eq(schema.storeNotices.reason, d.reason), gte(schema.storeNotices.createdAt, new Date(now.getTime() - 30 * DAY))),
      });
      if (recent) continue;
      await sendNotice(db, { shopId: id, kind: "warning", reason: d.reason, explanation: d.explanation, by: "Automatic check" }, now);
      warned++;
    }
  }
  return { checked: shops.length, warned };
}

// Verified badge ------------------------------------------------------------------------------

export const VERIFIED_RULES = { minAgeDays: 30, minShipped: 10, onTimeRate: 0.9, maxRefundRate: 0.05 };

/** The public meaning of the badge, one line per rule, and whether this store meets each. */
export async function verifiedChecklist(db: Db, shop: Shop, now = new Date()) {
  const [health, notices, pages] = await Promise.all([
    storeHealth(db, shop.id, now),
    openNotices(db, shop.id),
    db.query.pages.findMany({ where: and(eq(schema.pages.shopId, shop.id), eq(schema.pages.published, true)), columns: { handle: true, title: true } }),
  ]);
  const ageDays = Math.floor((now.getTime() - shop.createdAt.getTime()) / DAY);
  const hasReturns = pages.some((p) => /return|refund/i.test(`${p.handle} ${p.title}`));
  const pct = (r: number | null) => (r === null ? "no data yet" : `${Math.round(r * 100)}%`);
  const items = [
    { key: "identity", label: "Owner's identity and bank account checked by Stripe", met: shop.payoutsEnabled, detail: shop.payoutsEnabled ? "Checked" : "Finish payout setup on the Money page" },
    { key: "age", label: `Selling for at least ${VERIFIED_RULES.minAgeDays} days`, met: ageDays >= VERIFIED_RULES.minAgeDays, detail: `${ageDays} ${ageDays === 1 ? "day" : "days"}` },
    { key: "shipped", label: `At least ${VERIFIED_RULES.minShipped} orders shipped with tracking`, met: health.shippedOrders >= VERIFIED_RULES.minShipped, detail: `${health.shippedOrders} in the last 90 days` },
    { key: "on_time", label: `${VERIFIED_RULES.onTimeRate * 100}% or more of orders ship within ${LATE_SHIP_DAYS} days`, met: health.onTimeRate !== null && health.onTimeRate >= VERIFIED_RULES.onTimeRate, detail: pct(health.onTimeRate) },
    { key: "refunds", label: `Refunds on ${VERIFIED_RULES.maxRefundRate * 100}% of orders or fewer`, met: health.refundRate === null || health.refundRate <= VERIFIED_RULES.maxRefundRate, detail: pct(health.refundRate) },
    { key: "returns", label: "A returns policy buyers can read", met: hasReturns, detail: hasReturns ? "Published" : "Add a page called Returns under Pages" },
    { key: "standing", label: "In good standing, with no open warnings", met: notices.length === 0 && shop.status === "active", detail: notices.length ? `${notices.length} open` : "Good standing" },
  ];
  return { items, met: items.every((i) => i.met), health };
}

/** Recompute the badge. Keeps the original "verified since" date while the store still qualifies. */
export async function refreshVerified(db: Db, shopId: string, now = new Date()) {
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  if (!shop) throw new NotFoundError("Store");
  const { met } = await verifiedChecklist(db, shop, now);
  const verifiedAt = met ? (shop.verifiedAt ?? now) : null;
  if ((verifiedAt?.getTime() ?? null) !== (shop.verifiedAt?.getTime() ?? null)) {
    await db.update(schema.shops).set({ verifiedAt }).where(eq(schema.shops.id, shopId));
  }
  return verifiedAt;
}

export async function refreshAllVerified(db: Db, now = new Date()) {
  const shops = await db.query.shops.findMany({ columns: { id: true } });
  let verified = 0;
  for (const s of shops) if (await refreshVerified(db, s.id, now)) verified++;
  return { checked: shops.length, verified };
}

/** For the staff page: every store with its standing. */
export async function listStoresForStaff(db: Db) {
  return db.query.shops.findMany({ orderBy: desc(schema.shops.createdAt), limit: 200 });
}

export async function getShopForStaff(db: Db, shopId: string) {
  return (await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) })) ?? null;
}
