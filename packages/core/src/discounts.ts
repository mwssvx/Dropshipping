import { and, count, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
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
    kind: z.enum(["percent", "amount", "free_shipping", "bxgy"]),
    value: z.number().int().min(0).default(0),
    buyQty: z.number().int().nullish(),
    getQty: z.number().int().nullish(),
    productIds: z.array(z.string().uuid()).max(100, "Pick up to 100 products.").default([]),
    automatic: z.boolean().default(false),
    minSubtotalMinor: z.number().int().min(0).default(0),
    usageLimit: z.number().int().min(1, "The limit must be at least 1.").nullish(),
    oncePerCustomer: z.boolean().default(false),
    startsAt: z.date().nullish(),
    endsAt: z.date().nullish(),
  })
  .superRefine((d, ctx) => {
    if (d.kind === "percent" && (d.value < 1 || d.value > 100)) ctx.addIssue({ code: "custom", message: "A percentage is between 1 and 100." });
    if (d.kind === "amount" && d.value < 1) ctx.addIssue({ code: "custom", message: "Enter the amount to take off." });
    if (d.kind === "bxgy") {
      if (!d.buyQty || d.buyQty < 1 || d.buyQty > 20) ctx.addIssue({ code: "custom", message: "Say how many they buy, from 1 to 20." });
      if (!d.getQty || d.getQty < 1 || d.getQty > 20) ctx.addIssue({ code: "custom", message: "Say how many they get, from 1 to 20." });
      if (d.value < 1 || d.value > 100) ctx.addIssue({ code: "custom", message: "The items they get are 1 to 100% off (100 is free)." });
    }
    if (d.automatic && d.kind === "free_shipping") ctx.addIssue({ code: "custom", message: "Free shipping over an amount is set under Shipping instead." });
    // Money off without a code needs a minimum order ("Spend more, save more"); money off everything is a sale.
    if (d.automatic && (d.kind === "percent" || d.kind === "amount") && d.minSubtotalMinor < 1) {
      ctx.addIssue({ code: "custom", message: "Set a minimum order for money off without a code. For money off everything, start a sale." });
    }
    if (d.startsAt && d.endsAt && d.endsAt <= d.startsAt) ctx.addIssue({ code: "custom", message: "The end date must be after the start date." });
  });

export type DiscountInput = z.input<typeof discountInput>;

export async function createDiscount(db: Db, shopId: string, input: DiscountInput) {
  const parsed = discountInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const d = parsed.data;
  const existing = await db.query.discounts.findFirst({ where: and(eq(schema.discounts.shopId, shopId), eq(schema.discounts.code, d.code)) });
  if (existing) throw new UserError(`You already have a code called ${d.code}.`);
  const bxgy = d.kind === "bxgy";
  const productIds = bxgy ? [...new Set(d.productIds)] : [];
  if (productIds.length) {
    const found = await db.query.products.findMany({ where: and(eq(schema.products.shopId, shopId), inArray(schema.products.id, productIds)), columns: { id: true } });
    if (found.length !== productIds.length) throw new NotFoundError("Product");
  }
  const [row] = await db
    .insert(schema.discounts)
    .values({
      ...d,
      value: d.kind === "free_shipping" ? 0 : d.value,
      buyQty: bxgy ? d.buyQty! : null,
      getQty: bxgy ? d.getQty! : null,
      productIds,
      automatic: d.kind !== "free_shipping" && d.automatic,
      usageLimit: d.usageLimit ?? null,
      startsAt: d.startsAt ?? null,
      endsAt: d.endsAt ?? null,
      shopId,
    })
    .returning();
  return row!;
}

/** Codes with how many paid orders used them and what they took off. */
export async function listDiscounts(db: Db, shopId: string) {
  // Welcome codes (one per signup) are summed up in the welcome offer instead.
  const rows = await db.query.discounts.findMany({ where: and(eq(schema.discounts.shopId, shopId), eq(schema.discounts.source, "merchant")), orderBy: desc(schema.discounts.createdAt) });
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
  const [row] = await db
    .update(schema.discounts)
    .set({ active })
    .where(and(eq(schema.discounts.id, id), eq(schema.discounts.shopId, shopId), eq(schema.discounts.source, "merchant")))
    .returning();
  if (!row) throw new NotFoundError("Discount");
  return row;
}

type Describable = Pick<Discount, "kind" | "value" | "minSubtotalMinor"> & Partial<Pick<Discount, "buyQty" | "getQty" | "productIds">>;

export function describeDiscount(d: Describable, currency: string) {
  if (d.kind === "bxgy") {
    const what = `Buy ${d.buyQty}, get ${d.getQty} ${d.value >= 100 ? "free" : `${d.value}% off`}`;
    return [what, d.productIds?.length ? "on selected products" : null, d.minSubtotalMinor ? `on orders over ${formatMoney(d.minSubtotalMinor, currency)}` : null].filter(Boolean).join(" ");
  }
  const what = d.kind === "percent" ? `${d.value}% off` : d.kind === "amount" ? `${formatMoney(d.value, currency)} off` : "Free shipping";
  return d.minSubtotalMinor ? `${what} orders over ${formatMoney(d.minSubtotalMinor, currency)}` : what;
}

/* Buy X get Y */

export type OfferUnit = { productId: string; unitMinor: number; quantity: number };
type Bxgy = Pick<Discount, "value" | "buyQty" | "getQty" | "productIds">;

const eligible = (d: Bxgy, units: OfferUnit[]) =>
  units.filter((u) => !d.productIds.length || d.productIds.includes(u.productId)).flatMap((u) => Array<number>(u.quantity).fill(u.unitMinor));

/**
 * What buy X get Y takes off: for every X items bought, the next Y are discounted, and the ones
 * discounted are always the cheapest in the cart. Rounds down, like percent codes.
 */
export function bxgyDiscount(d: Bxgy, units: OfferUnit[]) {
  const prices = eligible(d, units).sort((a, b) => b - a);
  const group = d.buyQty! + d.getQty!;
  const given = Math.floor(prices.length / group) * d.getQty!;
  const value = prices.slice(prices.length - given).reduce((s, p) => s + p, 0);
  return given ? Math.floor((value * d.value) / 100) : 0;
}

/** How many more items would be discounted right away, when the cart is one step from it. */
export function bxgyMissing(d: Bxgy, units: OfferUnit[]) {
  const n = eligible(d, units).length;
  const group = d.buyQty! + d.getQty!;
  const r = n % group;
  return r >= d.buyQty! ? group - r : 0;
}

/** Offers that apply without a code, running now: buy X get Y, and money off orders over an amount. */
export async function automaticOffers(db: Db, shopId: string, now = new Date()) {
  const t = schema.discounts;
  return db.query.discounts.findMany({
    where: and(
      eq(t.shopId, shopId),
      eq(t.automatic, true),
      eq(t.active, true),
      eq(t.source, "merchant"),
      or(isNull(t.startsAt), lte(t.startsAt, now)),
      or(isNull(t.endsAt), gt(t.endsAt, now)),
    ),
    orderBy: desc(t.createdAt),
  });
}

/** The automatic offers a product page should mention. */
export async function productOffers(db: Db, shop: Shop, productId: string, now = new Date()) {
  const offers = await automaticOffers(db, shop.id, now);
  return offers.filter((d) => !d.productIds.length || d.productIds.includes(productId)).map((d) => describeDiscount({ ...d, productIds: [] }, shop.currency));
}

/**
 * The discount a buyer typed, if it can be used on this cart right now. Throws a message for the
 * buyer otherwise. `email` is checked only at checkout, for once-per-customer codes and codes
 * made for one buyer.
 */
export async function findUsableDiscount(db: Db, shop: Shop, code: string, cart: { subtotalMinor: number; email?: string }, now = new Date()) {
  const clean = code.trim().toUpperCase();
  const d = await db.query.discounts.findFirst({ where: and(eq(schema.discounts.shopId, shop.id), eq(schema.discounts.code, clean)) });
  if (!d || !d.active || (d.startsAt && d.startsAt > now)) throw new UserError(`"${clean}" isn't a valid code.`, "discount_invalid");
  if (d.email && cart.email && cart.email.trim().toLowerCase() !== d.email) {
    throw new UserError(`${clean} was sent to a different email address. Check out with that address to use it.`, "discount_invalid");
  }
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
export function applyDiscount(d: Pick<Discount, "kind" | "value"> & Partial<Bxgy>, subtotalMinor: number, shippingMinor: number, units: OfferUnit[] = []) {
  if (d.kind === "free_shipping") return { discountMinor: 0, shippingMinor: 0 };
  if (d.kind === "bxgy") return { discountMinor: Math.min(subtotalMinor, bxgyDiscount({ value: d.value, buyQty: d.buyQty ?? 1, getQty: d.getQty ?? 1, productIds: d.productIds ?? [] }, units)), shippingMinor };
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
