// The daily store watch: plain arithmetic that spots a day that's out of line with the store's own
// recent normal (sales, visitors, checkout, refunds). Quiet days produce nothing, so the AI that
// explains a signal only runs, and only costs, when something actually moved.
import { and, count, eq, gte, lt } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import type { Shop } from "./ai/context";
import { analyticsReport } from "./analytics";
import { formatMoney } from "./money";

const DAY = 86_400_000;
/** How many days before yesterday make up the store's normal. */
export const WATCH_BASELINE_DAYS = 28;

export type WatchSignal = {
  kind: "sales_drop" | "sales_jump" | "visitors_drop" | "checkout_drop" | "refunds_up";
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
  const [y, base, refundsWeek, refundsBefore] = await Promise.all([
    analyticsReport(db, shop.id, day),
    analyticsReport(db, shop.id, before),
    countRefunds(db, shop.id, new Date(day.to.getTime() - 7 * DAY), day.to),
    countRefunds(db, shop.id, before.from, new Date(day.to.getTime() - 7 * DAY)),
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
  return signals;
}

async function countRefunds(db: Db, shopId: string, from: Date, to: Date) {
  const [r] = await db
    .select({ n: count() })
    .from(schema.refunds)
    .where(and(eq(schema.refunds.shopId, shopId), gte(schema.refunds.createdAt, from), lt(schema.refunds.createdAt, to)));
  return Number(r?.n ?? 0);
}
