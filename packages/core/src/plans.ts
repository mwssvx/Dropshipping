import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { formatMoney } from "./money";

/*
 * Pricing, decided 2026-10-08 and raised 2026-11-12: start free with a cut of each sale, then pay
 * a flat monthly price with no cut once you're earning. Prices are in USD cents; other currencies
 * use the same numbers for now.
 */

export type PlanId = (typeof schema.shops.$inferSelect)["plan"];

/** teamSeats: people besides the owner who can help run the store. */
export const PLANS: Record<PlanId, { name: string; monthlyMinor: number; feeBps: number; ordersPerMonth: number | null; teamSeats: number; blurb: string }> = {
  free: { name: "Free", monthlyMinor: 0, feeBps: 500, ordersPerMonth: 50, teamSeats: 0, blurb: "Everything built in. Nothing to pay until you sell, then 5% of each sale." },
  starter: { name: "Starter", monthlyMinor: 2900, feeBps: 0, ordersPerMonth: 100, teamSeats: 0, blurb: "No cut of your sales. Up to 100 orders a month." },
  growth: { name: "Growth", monthlyMinor: 6900, feeBps: 0, ordersPerMonth: null, teamSeats: 0, blurb: "No cut of your sales. Unlimited orders, and a person answers within 12 hours." },
  scale: { name: "Scale", monthlyMinor: 19900, feeBps: 0, ordersPerMonth: null, teamSeats: 15, blurb: "For teams: up to 15 staff accounts with roles, and advanced analytics." },
};
export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

/** The free plan's cut as a percent, for copy ("5%"). */
export const FREE_FEE_PERCENT = PLANS.free.feeBps / 100;

/** Monthly sales at which a paid plan costs the same as the free plan's cut. */
export function breakEvenMinor(plan: PlanId) {
  return PLANS[plan].feeBps ? 0 : Math.round((PLANS[plan].monthlyMinor * 10_000) / PLANS.free.feeBps);
}

/** Our cut of one sale on this plan. Rounded half up to the cent. */
export function platformFeeFor(plan: PlanId, totalMinor: number) {
  return Math.round((totalMinor * PLANS[plan].feeBps) / 10_000);
}

/**
 * The card processor's fee, estimated at checkout so the merchant sees it per order.
 * Stripe's standard card rate (2.9% + 30¢ in the US; similar elsewhere) until real fees sync.
 */
export function estimateProcessingFee(totalMinor: number) {
  return Math.round(totalMinor * 0.029) + 30;
}

const DAY = 86_400_000;

/** Paid orders and sales fees over the last 30 days, and the plan that would cost least. */
export async function planAdvice(db: Db, shop: { id: string; plan: PlanId }, now = new Date()) {
  const since = new Date(now.getTime() - 30 * DAY);
  const [row] = await db
    .select({
      orders: sql<number>`count(*)::int`,
      sales: sql<number>`coalesce(sum(${schema.orders.totalMinor} - ${schema.orders.refundedMinor}), 0)::bigint`,
      fees: sql<number>`coalesce(sum(${schema.orders.platformFeeMinor}), 0)::bigint`,
    })
    .from(schema.orders)
    .where(and(eq(schema.orders.shopId, shop.id), inArray(schema.orders.paymentStatus, ["paid", "partially_refunded"]), gte(schema.orders.paidAt, since)));
  const orders = Number(row?.orders ?? 0);
  const sales = Number(row?.sales ?? 0);
  // What each plan would have cost for the same month of sales.
  const costs = PLAN_IDS.filter((p) => PLANS[p].ordersPerMonth === null || PLANS[p].ordersPerMonth! >= orders).map((p) => ({
    plan: p,
    costMinor: PLANS[p].monthlyMinor + platformFeeFor(p, sales),
  }));
  const best = costs.sort((a, b) => a.costMinor - b.costMinor)[0]!;
  const current = PLANS[shop.plan].monthlyMinor + Number(row?.fees ?? 0);
  const limit = PLANS[shop.plan].ordersPerMonth;
  return {
    orders,
    salesMinor: sales,
    feesMinor: Number(row?.fees ?? 0),
    currentCostMinor: current,
    best: best.plan !== shop.plan && best.costMinor < current ? { plan: best.plan, saveMinor: current - best.costMinor } : null,
    overLimit: limit !== null && orders > limit,
    nearLimit: limit !== null && orders >= limit * 0.8,
    upgradeHint: upgradeHint(shop.plan, sales),
  };
}

/**
 * "Start free, upgrade once you're earning": for a free store whose sales don't yet make a paid
 * plan cheaper, how much it would need to sell. Null on paid plans, and once a paid plan pays off
 * (the advice says so instead).
 */
export function upgradeHint(plan: PlanId, salesMinor: number) {
  if (plan !== "free") return null;
  const at = breakEvenMinor("starter");
  if (salesMinor >= at) return null;
  return `You pay nothing until you sell. Once you're earning about ${formatMoney(at, "USD").replace(/\.00$/, "")} a month, ${PLANS.starter.name} costs less than our ${FREE_FEE_PERCENT}% and keeps every sale yours. We'll tell you here when that happens.`;
}
