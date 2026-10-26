// Buyer accounts: a shopper signs in to one store with a six-digit code sent to their email, then
// sees their orders, buys again, and checks out with their details filled in. No passwords to forget.
import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, count, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { schema, type Address, type Db } from "@sf/db";
import { z } from "zod";
import type { Mailer } from "./email";
import { UserError } from "./errors";
import type { CartLine } from "./orders";
import { buyerAmounts } from "./currency";

const MINUTE = 60_000;
const CODE_MINUTES = 10;
const MAX_TRIES = 5;
const SESSION_DAYS = 60;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const codeHash = (shopId: string, email: string, code: string) => sha(`${shopId}:${email}:${code}`);
const email = z.string().trim().toLowerCase().email("Enter a valid email address.");

/** Emails a sign-in code, valid for ten minutes. At most five codes an hour for one email. */
export async function requestBuyerCode(ctx: { db: Db; mailer: Mailer }, shop: { id: string; name: string }, emailInput: string, now = new Date()) {
  const parsed = email.safeParse(emailInput);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const address = parsed.data;
  const [recent] = await ctx.db
    .select({ n: count() })
    .from(schema.buyerCodes)
    .where(and(eq(schema.buyerCodes.shopId, shop.id), eq(schema.buyerCodes.email, address), gt(schema.buyerCodes.createdAt, new Date(now.getTime() - 60 * MINUTE))));
  if (Number(recent?.n ?? 0) >= 5) throw new UserError("We've sent several codes already. Use the latest one, or try again in an hour.", "throttled");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await ctx.db.insert(schema.buyerCodes).values({ shopId: shop.id, email: address, codeHash: codeHash(shop.id, address, code), expiresAt: new Date(now.getTime() + CODE_MINUTES * MINUTE), createdAt: now });
  await ctx.mailer.send({
    to: address,
    subject: `${code} is your ${shop.name} sign-in code`,
    text: [`Your code to sign in to ${shop.name}:`, "", code, "", `It works for ${CODE_MINUTES} minutes. If you didn't ask for it, ignore this email.`].join("\n"),
  });
  return { email: address };
}

/** Checks the code and starts a buyer session. Five wrong tries use the code up. */
export async function verifyBuyerCode(db: Db, shopId: string, emailInput: string, codeInput: string, now = new Date()) {
  const address = email.parse(emailInput);
  const code = codeInput.replace(/\D/g, "");
  const latest = await db.query.buyerCodes.findFirst({
    where: and(eq(schema.buyerCodes.shopId, shopId), eq(schema.buyerCodes.email, address), isNull(schema.buyerCodes.usedAt)),
    orderBy: desc(schema.buyerCodes.createdAt),
  });
  if (!latest || latest.expiresAt <= now || latest.attempts >= MAX_TRIES) throw new UserError("That code has expired. Ask for a new one.", "expired");
  if (latest.codeHash !== codeHash(shopId, address, code)) {
    await db.update(schema.buyerCodes).set({ attempts: sql`${schema.buyerCodes.attempts} + 1` }).where(eq(schema.buyerCodes.id, latest.id));
    const left = MAX_TRIES - latest.attempts - 1;
    throw new UserError(left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "That code isn't right. Ask for a new one.", "wrong_code");
  }
  const token = randomBytes(32).toString("base64url");
  const customer = await db.transaction(async (tx) => {
    await tx.update(schema.buyerCodes).set({ usedAt: now }).where(eq(schema.buyerCodes.id, latest.id));
    const [row] = await tx
      .insert(schema.customers)
      .values({ shopId, email: address, lastSignInAt: now })
      .onConflictDoUpdate({ target: [schema.customers.shopId, schema.customers.email], set: { lastSignInAt: now } })
      .returning();
    await tx.insert(schema.buyerSessions).values({ tokenHash: sha(token), shopId, customerId: row!.id, expiresAt: new Date(now.getTime() + SESSION_DAYS * 1440 * MINUTE), createdAt: now });
    return row!;
  });
  return { token, customer };
}

export async function getBuyer(db: Db, shopId: string, token: string | undefined, now = new Date()) {
  if (!token) return null;
  const [row] = await db
    .select({ id: schema.customers.id, email: schema.customers.email, name: schema.customers.name, acceptsMarketing: schema.customers.acceptsMarketing, priceAlerts: schema.customers.priceAlerts, wholesaleStatus: schema.customers.wholesaleStatus, wholesaleCompany: schema.customers.wholesaleCompany })
    .from(schema.buyerSessions)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.buyerSessions.customerId))
    .where(and(eq(schema.buyerSessions.tokenHash, sha(token)), eq(schema.buyerSessions.shopId, shopId), gt(schema.buyerSessions.expiresAt, now)))
    .limit(1);
  return row ?? null;
}

export async function signOutBuyer(db: Db, token: string) {
  await db.delete(schema.buyerSessions).where(eq(schema.buyerSessions.tokenHash, sha(token)));
}

const PLACED = ["paid", "partially_refunded", "refunded"] as const;

/** Paid orders placed with the buyer's email at this store, newest first, with their items. */
export async function buyerOrders(db: Db, shopId: string, buyerEmail: string) {
  const orders = await db.query.orders.findMany({
    where: and(eq(schema.orders.shopId, shopId), eq(schema.orders.email, buyerEmail.toLowerCase()), inArray(schema.orders.paymentStatus, [...PLACED])),
    orderBy: desc(schema.orders.paidAt),
    limit: 50,
  });
  if (!orders.length) return [];
  const lines = await db.query.orderLines.findMany({ where: inArray(schema.orderLines.orderId, orders.map((o) => o.id)) });
  return orders.map((o) => {
    // In the buyer's own currency when they shopped in one.
    const paid = buyerAmounts(o);
    return {
      id: o.id,
      number: o.number,
      ref: o.paymentIntentId!,
      paidAt: o.paidAt!,
      currency: paid.currency,
      totalMinor: paid.totalMinor,
      refundedMinor: paid.refundedMinor,
      paymentStatus: o.paymentStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      items: lines.filter((l) => l.orderId === o.id).map((l) => ({ title: l.title, quantity: l.quantity, variantId: l.variantId })),
    };
  });
}

/** Details for checkout from the buyer's last order: their email, name and shipping address. */
export async function lastCheckoutDetails(db: Db, shopId: string, buyerEmail: string): Promise<{ email: string; address: Address | null }> {
  const last = await db.query.orders.findFirst({
    where: and(eq(schema.orders.shopId, shopId), eq(schema.orders.email, buyerEmail.toLowerCase()), inArray(schema.orders.paymentStatus, [...PLACED])),
    orderBy: desc(schema.orders.paidAt),
    columns: { shippingAddress: true },
  });
  return { email: buyerEmail, address: last?.shippingAddress ?? null };
}

/**
 * The items of a past order that can still be bought, to put in the cart. Products the store took
 * down or that sold out are left out and counted, so the page can say so.
 */
export async function reorderLines(db: Db, shopId: string, buyerEmail: string, orderId: string): Promise<{ lines: CartLine[]; missing: number }> {
  const order = await db.query.orders.findFirst({
    where: and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId), eq(schema.orders.email, buyerEmail.toLowerCase())),
    columns: { id: true },
  });
  if (!order) throw new UserError("We couldn't find that order.", "not_found");
  const items = await db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
  const ids = items.map((i) => i.variantId).filter((v): v is string => !!v);
  const live = ids.length
    ? await db
        .select({ id: schema.variants.id, stock: schema.variants.stock })
        .from(schema.variants)
        .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
        .where(and(inArray(schema.variants.id, ids), eq(schema.products.shopId, shopId), eq(schema.products.status, "active")))
    : [];
  const lines: CartLine[] = [];
  for (const item of items) {
    const v = live.find((x) => x.id === item.variantId);
    if (!v || (v.stock !== null && v.stock <= 0)) continue;
    lines.push({ variantId: v.id, quantity: v.stock === null ? item.quantity : Math.min(item.quantity, v.stock) });
  }
  return { lines, missing: items.length - lines.length };
}

/** Customers for the merchant: who bought, how often, how much and when last. */
export async function listCustomers(db: Db, shopId: string, opts: { query?: string; tag?: string; limit?: number } = {}) {
  const q = opts.query?.trim().toLowerCase();
  const tag = opts.tag?.trim().toLowerCase();
  const rows = await db
    .select({
      id: schema.customers.id,
      email: schema.customers.email,
      name: schema.customers.name,
      createdAt: schema.customers.createdAt,
      lastSignInAt: schema.customers.lastSignInAt,
      acceptsMarketing: schema.customers.acceptsMarketing,
      tags: schema.customers.tags,
      orders: sql<number>`count(${schema.orders.id}) filter (where ${schema.orders.paymentStatus} in ('paid', 'partially_refunded', 'refunded'))`.mapWith(Number),
      spentMinor: sql<number>`coalesce(sum(${schema.orders.totalMinor} - ${schema.orders.refundedMinor}) filter (where ${schema.orders.paymentStatus} in ('paid', 'partially_refunded', 'refunded')), 0)`.mapWith(Number),
      lastOrderAt: sql<Date | null>`max(${schema.orders.paidAt})`.mapWith((v) => (v ? new Date(v) : null)),
    })
    .from(schema.customers)
    .leftJoin(schema.orders, and(eq(schema.orders.shopId, schema.customers.shopId), eq(schema.orders.email, schema.customers.email)))
    .where(
      and(
        eq(schema.customers.shopId, shopId),
        q ? sql`(lower(${schema.customers.email}) like ${`%${q}%`} or lower(coalesce(${schema.customers.name}, '')) like ${`%${q}%`})` : undefined,
        tag ? sql`${schema.customers.tags} @> ${JSON.stringify([tag])}::jsonb` : undefined,
      ),
    )
    .groupBy(schema.customers.id)
    // Leaves out addresses that only asked for the newsletter and never confirmed or bought.
    .having(sql`count(${schema.orders.id}) > 0 or bool_or(${schema.customers.acceptsMarketing}) or max(${schema.customers.lastSignInAt}) is not null or max(${schema.customers.name}) is not null or bool_or(${schema.customers.wholesaleStatus} = 'approved') or max(jsonb_array_length(${schema.customers.tags})) > 0`)
    .orderBy(sql`max(${schema.orders.paidAt}) desc nulls last`, desc(schema.customers.createdAt))
    .limit(opts.limit ?? 500);
  return rows;
}

/** Old codes and expired buyer sessions are dropped by the scheduled job. */
export async function pruneBuyerRecords(db: Db, now = new Date()) {
  await db.delete(schema.buyerCodes).where(lt(schema.buyerCodes.expiresAt, new Date(now.getTime() - 1440 * MINUTE)));
  await db.delete(schema.buyerSessions).where(lt(schema.buyerSessions.expiresAt, now));
}
