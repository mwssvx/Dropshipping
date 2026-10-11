// Purchase limits: the least and most of a product a buyer can order at once, and the most one
// buyer can get in all (a limited drop at "2 per customer", or a cheap item sold in sets of 3).
// The cart shows what's wrong next to the item; checkout won't start until it's fixed. The
// per-customer limit counts the buyer's earlier paid orders by email, so it's checked at checkout.
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { schema, type Db, type PurchaseLimit } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";

const PAID = ["paid", "partially_refunded"] as const;

const count = (most: number) => z.number().int().min(1).max(most).nullable().default(null);
const limitSchema = z.object({ min: count(99), max: count(99), perCustomer: count(999) });

/** What's wrong with how many of a product are in a cart. */
export type LimitProblem = { kind: "min" | "max" | "customer"; limit: number; bought: number };

/** Saves a product's limits; all empty turns them off. */
export async function setPurchaseLimit(db: Db, shopId: string, productId: string, input: z.input<typeof limitSchema>) {
  const parsed = limitSchema.safeParse(input);
  if (!parsed.success) throw new UserError("Limits are whole numbers: up to 99 per order and 999 per customer.");
  const { min, max, perCustomer } = parsed.data;
  if (min != null && max != null && min > max) throw new UserError("The least per order can't be more than the most per order.");
  if (min != null && perCustomer != null && min > perCustomer) throw new UserError("The least per order can't be more than the most per customer.");
  if (max != null && perCustomer != null && max > perCustomer) throw new UserError("The most per order can't be more than the most per customer.");
  // A minimum of 1 is what every product already has.
  const limit: PurchaseLimit | null = (min ?? 1) > 1 || max != null || perCustomer != null ? { min: min != null && min > 1 ? min : null, max, perCustomer } : null;
  const [row] = await db
    .update(schema.products)
    .set({ purchaseLimit: limit, updatedAt: new Date() })
    .where(and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)))
    .returning({ id: schema.products.id });
  if (!row) throw new NotFoundError("Product");
  return limit;
}

/** How many of each product this email has on paid orders (free replacements don't count). */
export async function boughtBefore(db: Db, shopId: string, email: string, productIds: string[]) {
  const bought = new Map<string, number>();
  if (!productIds.length || !email.trim()) return bought;
  const rows = await db
    .select({ productId: schema.variants.productId, n: sql<number>`sum(${schema.orderLines.quantity})::int` })
    .from(schema.orderLines)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
    .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .where(
      and(
        eq(schema.orders.shopId, shopId),
        sql`lower(${schema.orders.email}) = ${email.trim().toLowerCase()}`,
        inArray(schema.orders.paymentStatus, [...PAID]),
        ne(schema.orders.source, "replacement"),
        inArray(schema.variants.productId, productIds),
      ),
    )
    .groupBy(schema.variants.productId);
  for (const r of rows) bought.set(r.productId, Number(r.n));
  return bought;
}

/** The problem with `quantity` of a product in one order, given what the buyer bought before. */
export function limitProblem(limit: PurchaseLimit | null, quantity: number, bought = 0): LimitProblem | null {
  if (!limit) return null;
  if (limit.max != null && quantity > limit.max) return { kind: "max", limit: limit.max, bought };
  if (limit.perCustomer != null && quantity + bought > limit.perCustomer) return { kind: "customer", limit: limit.perCustomer, bought };
  if (limit.min != null && quantity < limit.min) return { kind: "min", limit: limit.min, bought };
  return null;
}

/** The problem in plain English, for checkout errors and the API. */
export function describeLimitProblem(p: LimitProblem, title: string) {
  if (p.kind === "min") return `${title} is sold in sets of at least ${p.limit}.`;
  if (p.kind === "max") return `You can buy up to ${p.limit} of ${title} per order.`;
  const left = Math.max(0, p.limit - p.bought);
  return left
    ? `${title} is limited to ${p.limit} per customer, and you've already bought ${p.bought}. You can add ${left} more.`
    : `${title} is limited to ${p.limit} per customer, and you've already bought ${p.bought}.`;
}

/** The limits as a short note for the merchant: "2 to 5 per order, 10 per customer". */
export function describePurchaseLimit(limit: PurchaseLimit | null) {
  if (!limit) return null;
  const perOrder =
    limit.min != null && limit.max != null ? `${limit.min} to ${limit.max} per order` : limit.min != null ? `at least ${limit.min} per order` : limit.max != null ? `up to ${limit.max} per order` : null;
  const parts = [perOrder, limit.perCustomer != null ? `${limit.perCustomer} per customer` : null].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
