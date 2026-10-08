import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { formatMoney } from "./money";

type Shop = typeof schema.shops.$inferSelect;
export type Discount = typeof schema.discounts.$inferSelect;

const PAID = ["paid", "partially_refunded", "refunded"] as const;

const discountInput = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,30}$/, "Codes are 3 to 30 letters, numbers, dashes or underscores."),
    kind: z.enum(["percent", "amount", "free_shipping"]),
    value: z.number().int().min(0).default(0),
    minSubtotalMinor: z.number().int().min(0).default(0),
    usageLimit: z.number().int().min(1, "The limit must be at least 1.").nullish(),
    oncePerCustomer: z.boolean().default(false),
    startsAt: z.date().nullish(),
    endsAt: z.date().nullish(),
  })
  .superRefine((d, ctx) => {
    if (d.kind === "percent" && (d.value < 1 || d.value > 100)) ctx.addIssue({ code: "custom", message: "A percentage is between 1 and 100." });
    if (d.kind === "amount" && d.value < 1) ctx.addIssue({ code: "custom", message: "Enter the amount to take off." });
    if (d.startsAt && d.endsAt && d.endsAt <= d.startsAt) ctx.addIssue({ code: "custom", message: "The end date must be after the start date." });
  });

export type DiscountInput = z.input<typeof discountInput>;

export async function createDiscount(db: Db, shopId: string, input: DiscountInput) {
  const parsed = discountInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const d = parsed.data;
  const existing = await db.query.discounts.findFirst({ where: and(eq(schema.discounts.shopId, shopId), eq(schema.discounts.code, d.code)) });
  if (existing) throw new UserError(`You already have a code called ${d.code}.`);
  const [row] = await db
    .insert(schema.discounts)
    .values({ ...d, value: d.kind === "free_shipping" ? 0 : d.value, usageLimit: d.usageLimit ?? null, startsAt: d.startsAt ?? null, endsAt: d.endsAt ?? null, shopId })
    .returning();
  return row!;
}

/** Codes with how many paid orders used them and what they took off. */
export async function listDiscounts(db: Db, shopId: string) {
  const rows = await db.query.discounts.findMany({ where: eq(schema.discounts.shopId, shopId), orderBy: desc(schema.discounts.createdAt) });
  if (!rows.length) return [];
  const used = await db
    .select({ id: schema.orders.discountId, n: count(), off: sql<number>`coalesce(sum(${schema.orders.discountMinor}), 0)::bigint`, sales: sql<number>`coalesce(sum(${schema.orders.totalMinor}), 0)::bigint` })
    .from(schema.orders)
    .where(and(eq(schema.orders.shopId, shopId), inArray(schema.orders.paymentStatus, [...PAID]), inArray(schema.orders.discountId, rows.map((r) => r.id))))
    .groupBy(schema.orders.discountId);
  return rows.map((r) => {
    const u = used.find((x) => x.id === r.id);
    return { ...r, used: Number(u?.n ?? 0), discountedMinor: Number(u?.off ?? 0), salesMinor: Number(u?.sales ?? 0) };
  });
}

export async function setDiscountActive(db: Db, shopId: string, id: string, active: boolean) {
  const [row] = await db.update(schema.discounts).set({ active }).where(and(eq(schema.discounts.id, id), eq(schema.discounts.shopId, shopId))).returning();
  if (!row) throw new NotFoundError("Discount");
  return row;
}

export function describeDiscount(d: Pick<Discount, "kind" | "value" | "minSubtotalMinor">, currency: string) {
  const what = d.kind === "percent" ? `${d.value}% off` : d.kind === "amount" ? `${formatMoney(d.value, currency)} off` : "Free shipping";
  return d.minSubtotalMinor ? `${what} orders over ${formatMoney(d.minSubtotalMinor, currency)}` : what;
}

/**
 * The discount a buyer typed, if it can be used on this cart right now. Throws a message for the
 * buyer otherwise. `email` is checked only at checkout, for once-per-customer codes.
 */
export async function findUsableDiscount(db: Db, shop: Shop, code: string, cart: { subtotalMinor: number; email?: string }, now = new Date()) {
  const clean = code.trim().toUpperCase();
  const d = await db.query.discounts.findFirst({ where: and(eq(schema.discounts.shopId, shop.id), eq(schema.discounts.code, clean)) });
  if (!d || !d.active || (d.startsAt && d.startsAt > now)) throw new UserError(`"${clean}" isn't a valid code.`, "discount_invalid");
  if (d.endsAt && d.endsAt <= now) throw new UserError(`The code ${clean} has expired.`, "discount_invalid");
  if (cart.subtotalMinor < d.minSubtotalMinor) {
    throw new UserError(`${clean} works on orders over ${formatMoney(d.minSubtotalMinor, shop.currency)}.`, "discount_invalid");
  }
  const paidWith = and(eq(schema.orders.discountId, d.id), inArray(schema.orders.paymentStatus, [...PAID]));
  if (d.usageLimit !== null) {
    const [u] = await db.select({ n: count() }).from(schema.orders).where(paidWith);
    if (Number(u?.n ?? 0) >= d.usageLimit) throw new UserError(`The code ${clean} has been used up.`, "discount_invalid");
  }
  if (d.oncePerCustomer && cart.email) {
    const [u] = await db.select({ n: count() }).from(schema.orders).where(and(paidWith, eq(schema.orders.email, cart.email.trim().toLowerCase())));
    if (Number(u?.n ?? 0) > 0) throw new UserError(`You've already used ${clean}.`, "discount_invalid");
  }
  return d;
}

/** What a discount takes off. Percentages round down so the buyer never pays less than shown. */
export function applyDiscount(d: Pick<Discount, "kind" | "value">, subtotalMinor: number, shippingMinor: number) {
  if (d.kind === "free_shipping") return { discountMinor: 0, shippingMinor: 0 };
  const off = d.kind === "percent" ? Math.floor((subtotalMinor * d.value) / 100) : Math.min(d.value, subtotalMinor);
  return { discountMinor: off, shippingMinor };
}

/** Spreads a discount over the lines in proportion, for tax. Leftover cents go to the largest remainders. */
export function spreadDiscount(lines: number[], discountMinor: number) {
  const total = lines.reduce((s, l) => s + l, 0);
  if (!discountMinor || !total) return lines;
  const exact = lines.map((l) => (discountMinor * l) / total);
  const shares = exact.map(Math.floor);
  let left = discountMinor - shares.reduce((s, x) => s + x, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (!left) break;
    if (shares[i]! < lines[i]!) {
      shares[i]!++;
      left--;
    }
  }
  return lines.map((l, i) => l - shares[i]!);
}
