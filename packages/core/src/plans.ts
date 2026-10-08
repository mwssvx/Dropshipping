import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";

/*
 * Pricing, decided 2026-10-08: start free with a small cut of each sale, or pay a flat monthly
 * price with no cut. Prices are in USD cents; other currencies use the same numbers for now.
 */

export type PlanId = (typeof schema.shops.$inferSelect)["plan"];

/** teamSeats: people besides the owner who can help run the store. */
export const PLANS: Record<PlanId, { name: string; monthlyMinor: number; feeBps: number; ordersPerMonth: number | null; teamSeats: number; blurb: string }> = {
  free: { name: "Free", monthlyMinor: 0, feeBps: 200, ordersPerMonth: 50, teamSeats: 0, blurb: "Everything built in. We take 2% of each sale." },
  starter: { name: "Starter", monthlyMinor: 1900, feeBps: 0, ordersPerMonth: 100, teamSeats: 0, blurb: "No cut of your sales. Up to 100 orders a month." },
  growth: { name: "Growth", monthlyMinor: 4900, feeBps: 0, ordersPerMonth: null, teamSeats: 0, blurb: "No cut of your sales. Unlimited orders and priority support." },
  scale: { name: "Scale", monthlyMinor: 14900, feeBps: 0, ordersPerMonth: null, teamSeats: 15, blurb: "For teams: up to 15 staff accounts with roles, and advanced analytics." },
};
export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

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
  };
}
