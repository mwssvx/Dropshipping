// The daily store watch: plain arithmetic that spots a day that's out of line with the store's own
// recent normal (sales, visitors, checkout, refunds). Quiet days produce nothing, so the AI that
// explains a signal only runs, and only costs, when something actually moved.
import { and, count, eq, gte, isNotNull, isNull, lt } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import type { Shop } from "./ai/context";
import { analyticsReport } from "./analytics";
import { inventoryReport } from "./inventory";
import { formatMoney } from "./money";
import type { Mailer } from "./email";
import { can } from "./team";

const DAY = 86_400_000;
/** How many days before yesterday make up the store's normal. */
export const WATCH_BASELINE_DAYS = 28;

export const WATCH_KINDS = ["sales_drop", "sales_jump", "visitors_drop", "checkout_drop", "refunds_up", "stock_running_out", "supplier_failures"] as const;
/** A best seller with fewer days of stock than this left, and nothing on order, is flagged. */
export const WATCH_STOCK_DAYS = 7;

export type WatchSignal = {
  kind: (typeof WATCH_KINDS)[number];
  /** "high" and "medium" are problems; "good" is good news worth acting on. */
  tone: "high" | "medium" | "good";
  /** One line, with the numbers, for the alert and for the model. */
  headline: string;
  facts: Record<string, string | number>;
};

/** Yesterday (UTC) and the four weeks before it. */
export function watchDays(now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = { from: new Date(today - DAY), to: new Date(today) };
  return { day, before: { from: new Date(today - (WATCH_BASELINE_DAYS + 1) * DAY), to: day.from }, key: day.from.toISOString().slice(0, 10) };
}

const pct = (now: number, normal: number) => Math.round(((now - normal) / normal) * 100);

export async function storeSignals(db: Db, shop: Shop, now = new Date()): Promise<WatchSignal[]> {
  const { day, before } = watchDays(now);
  const [y, base, refundsWeek, refundsBefore, stock, failedY, sentY, failedBefore, sentBefore] = await Promise.all([
    analyticsReport(db, shop.id, day),
    analyticsReport(db, shop.id, before),
    countRefunds(db, shop.id, new Date(day.to.getTime() - 7 * DAY), day.to),
    countRefunds(db, shop.id, before.from, new Date(day.to.getTime() - 7 * DAY)),
    inventoryReport(db, shop, day.to),
    countSupplierOrders(db, shop.id, day, true),
    countSupplierOrders(db, shop.id, day, false),
    countSupplierOrders(db, shop.id, before, true),
    countSupplierOrders(db, shop.id, before, false),
  ]);
  const n = WATCH_BASELINE_DAYS;
  const normal = { sales: base.salesMinor / n, orders: base.orders / n, visitors: base.visitors / n };
  const money = (m: number) => formatMoney(Math.round(m), shop.currency);
  const signals: WatchSignal[] = [];

  // Sales: only for stores that sell most days, so one quiet day in a small store isn't an alarm.
  if (normal.orders >= 2 && y.salesMinor < normal.sales * 0.5) {
    const visitorsHeld = normal.visitors > 0 && y.visitors >= normal.visitors * 0.7;
    signals.push({
      kind: "sales_drop",
      tone: y.salesMinor < normal.sales * 0.25 ? "high" : "medium",
      headline: `Sales were ${money(y.salesMinor)} yesterday, ${-pct(y.salesMinor, normal.sales)}% below the usual ${money(normal.sales)} a day${visitorsHeld ? ", although visitors held up" : ""}.`,
      facts: { sales_yesterday: money(y.salesMinor), usual_sales_a_day: money(normal.sales), orders_yesterday: y.orders, usual_orders_a_day: normal.orders.toFixed(1), visitors_yesterday: y.visitors, usual_visitors_a_day: Math.round(normal.visitors) },
    });
  } else if (normal.orders >= 1 && y.orders >= 3 && y.salesMinor > normal.sales * 2) {
    const top = y.topProducts[0];
    signals.push({
      kind: "sales_jump",
      tone: "good",
      headline: `Sales were ${money(y.salesMinor)} yesterday, ${pct(y.salesMinor, normal.sales)}% above the usual ${money(normal.sales)} a day${top ? `, led by ${top.title}` : ""}.`,
      facts: { sales_yesterday: money(y.salesMinor), usual_sales_a_day: money(normal.sales), orders_yesterday: y.orders, top_product: top?.title ?? "", top_product_units: top?.units ?? 0 },
    });
  }

  if (normal.visitors >= 30 && y.visitors < normal.visitors * 0.5) {
    signals.push({
      kind: "visitors_drop",
      tone: y.visitors < normal.visitors * 0.25 ? "high" : "medium",
      headline: `${y.visitors} visitors yesterday, ${-pct(y.visitors, normal.visitors)}% below the usual ${Math.round(normal.visitors)} a day.`,
      facts: { visitors_yesterday: y.visitors, usual_visitors_a_day: Math.round(normal.visitors), top_sources_yesterday: y.sources.slice(0, 3).map((s) => `${s.source} ${s.visitors}`).join(", "), top_sources_usually: base.sources.slice(0, 3).map((s) => `${s.source} ${Math.round(s.visitors / n)}/day`).join(", ") },
    });
  }

  // Shoppers reach checkout but don't pay: the payment step or the shipping price is the usual cause.
  const started = y.funnel.find((f) => f.step === "Started checkout")!.count;
  const baseStarted = base.funnel.find((f) => f.step === "Started checkout")!.count;
  const usualRate = baseStarted >= 20 ? base.orders / baseStarted : null;
  if (usualRate !== null && started >= 5 && y.orders / started < usualRate * 0.4) {
    signals.push({
      kind: "checkout_drop",
      tone: y.orders === 0 ? "high" : "medium",
      headline: `${started} shoppers started checkout yesterday but only ${y.orders} paid (usually ${Math.round(usualRate * 100)}% do).`,
      facts: { checkouts_started: started, paid: y.orders, usual_paid_percent: Math.round(usualRate * 100) },
    });
  }

  const usualRefundsWeek = (refundsBefore / (n - 6)) * 7;
  if (refundsWeek >= 3 && refundsWeek > usualRefundsWeek * 2) {
    signals.push({
      kind: "refunds_up",
      tone: refundsWeek > usualRefundsWeek * 4 ? "high" : "medium",
      headline: `${refundsWeek} refunds in the last 7 days, against about ${Math.round(usualRefundsWeek * 10) / 10} in a usual week.`,
      facts: { refunds_last_7_days: refundsWeek, usual_refunds_a_week: Math.round(usualRefundsWeek * 10) / 10 },
    });
  }
  // Own stock: a product that sells steadily and will run out within the week, with nothing on order.
  const running = stock.rows
    .filter((r) => r.sold >= 5 && r.daysLeft !== null && r.daysLeft <= WATCH_STOCK_DAYS && r.incoming === 0)
    .sort((a, b) => a.daysLeft! - b.daysLeft!);
  if (running.length) {
    const first = running[0]!;
    const left = first.daysLeft === 0 ? "less than a day" : first.daysLeft === 1 ? "about 1 day" : `about ${first.daysLeft} days`;
    signals.push({
      kind: "stock_running_out",
      tone: first.daysLeft! <= 2 ? "high" : "medium",
      headline: `${first.title} has ${first.stock} left, ${left} at its recent pace, and nothing is on order${running.length > 1 ? ` (${running.length - 1} more ${running.length === 2 ? "product is" : "products are"} close too)` : ""}.`,
      facts: { product: first.title, in_stock: first.stock, sold_last_30_days: first.sold, days_left: first.daysLeft!, others_running_out: running.slice(1, 4).map((r) => `${r.title} (${r.daysLeft} days)`).join(", ") },
    });
  }

  // The supplier turned down more orders than usual: out of stock, an address it won't ship to, or an outage.
  const usualFailRate = sentBefore >= 10 ? failedBefore / sentBefore : 0.05;
  if (failedY >= 2 && failedY / Math.max(sentY, 1) >= Math.max(0.25, usualFailRate * 2)) {
    signals.push({
      kind: "supplier_failures",
      tone: failedY / Math.max(sentY, 1) >= 0.5 ? "high" : "medium",
      headline: `The supplier couldn't take ${failedY} of yesterday's ${sentY} orders (usually ${Math.round(usualFailRate * 100)}% fail).`,
      facts: { failed_yesterday: failedY, sent_yesterday: sentY, usual_failed_percent: Math.round(usualFailRate * 100) },
    });
  }
  return signals;
}

/** Supplier orders created in a window; `failed` counts only the ones the supplier turned down. */
async function countSupplierOrders(db: Db, shopId: string, w: { from: Date; to: Date }, failed: boolean) {
  const [r] = await db
    .select({ n: count() })
    .from(schema.fulfillments)
    .where(
      and(
        eq(schema.fulfillments.shopId, shopId),
        isNotNull(schema.fulfillments.supplierId),
        gte(schema.fulfillments.createdAt, w.from),
        lt(schema.fulfillments.createdAt, w.to),
        failed ? eq(schema.fulfillments.status, "failed") : undefined,
      ),
    );
  return Number(r?.n ?? 0);
}

async function countRefunds(db: Db, shopId: string, from: Date, to: Date) {
  const [r] = await db
    .select({ n: count() })
    .from(schema.refunds)
    .where(and(eq(schema.refunds.shopId, shopId), gte(schema.refunds.createdAt, from), lt(schema.refunds.createdAt, to)));
  return Number(r?.n ?? 0);
}

/**
 * Emails each store watch alert to the people who can see the store's money, once. Alerts older
 * than two days aren't sent late, since they're no longer news. Claimed before sending, so two
 * runs can't send one twice.
 */
export async function sendWatchEmails(ctx: { db: Db; mailer: Mailer; adminUrl: (path: string) => string }, now = new Date()) {
  const { db } = ctx;
  const fresh = await db.query.aiReports.findMany({
    where: and(eq(schema.aiReports.kind, "watch"), isNull(schema.aiReports.notifiedAt), gte(schema.aiReports.createdAt, new Date(now.getTime() - 2 * DAY))),
    limit: 200,
  });
  let sent = 0;
  for (const r of fresh) {
    const [claimed] = await db
      .update(schema.aiReports)
      .set({ notifiedAt: now })
      .where(and(eq(schema.aiReports.id, r.id), isNull(schema.aiReports.notifiedAt)))
      .returning({ id: schema.aiReports.id });
    if (!claimed || !r.items.length) continue;
    const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, r.shopId) });
    if (!shop?.aiWatchEmail) continue;
    const people = await db
      .select({ email: schema.users.email, role: schema.shopMembers.role })
      .from(schema.shopMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.shopMembers.userId))
      .where(eq(schema.shopMembers.shopId, shop.id));
    const [first, ...rest] = r.items;
    const text = [
      "Hi,",
      "",
      `The store watch noticed ${r.items.length === 1 ? "something" : `${r.items.length} things`} at ${shop.name} yesterday.`,
      ...r.items.flatMap((i) => ["", i.title, i.finding, `What to do: ${i.action}`]),
      "",
      "See it on the Insights page:",
      ctx.adminUrl("/admin/insights"),
      "",
      "You can turn these emails off in AI settings.",
    ].join("\n");
    for (const p of people.filter((x) => can(x.role, "money"))) {
      await ctx.mailer.send({ to: p.email, subject: `${shop.name}: ${first!.title.charAt(0).toLowerCase()}${first!.title.slice(1)}${rest.length ? ` (and ${rest.length} more)` : ""}`, text });
      sent++;
    }
  }
  return { sent };
}
