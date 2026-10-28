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
import { MAX_TAGS, normalizeTags } from "./customers";

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
    .select({ id: schema.customers.id, email: schema.customers.email, name: schema.customers.name, acceptsMarketing: schema.customers.acceptsMarketing, priceAlerts: schema.customers.priceAlerts, savedShareToken: schema.customers.savedShareToken, wholesaleStatus: schema.customers.wholesaleStatus, wholesaleCompany: schema.customers.wholesaleCompany })
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

const PAID_SQL = sql`('paid', 'partially_refunded', 'refunded')`;

/**
 * Quick filters for the customer list: subscribed to emails, bought more than once, bought before
 * but not in the last 90 days, or never bought (signed up, asked a question, or tagged).
 */
export const CUSTOMER_FILTERS = ["subscribed", "repeat", "lapsed", "never"] as const;
export type CustomerFilter = (typeof CUSTOMER_FILTERS)[number];
/** Days without an order before a buyer counts as lapsed. */
export const LAPSED_DAYS = 90;

type CustomerQuery = { query?: string; tag?: string; filter?: CustomerFilter; country?: string; now?: Date };

/** One row per customer the merchant should see, with what they've bought. */
function customerRows(db: Db, shopId: string, opts: CustomerQuery) {
  const q = opts.query?.trim().toLowerCase();
  const tag = opts.tag?.trim().toLowerCase();
  const paidCount = sql`count(${schema.orders.id}) filter (where ${schema.orders.paymentStatus} in ${PAID_SQL})`;
  const since = new Date((opts.now ?? new Date()).getTime() - LAPSED_DAYS * 86_400_000);
  // Bought at least once with delivery to this country (two letters).
  const country = opts.country && /^[A-Z]{2}$/i.test(opts.country) ? opts.country.toUpperCase() : undefined;
  const filter =
    opts.filter === "repeat"
      ? sql`${paidCount} > 1`
      : opts.filter === "lapsed"
        ? sql`${paidCount} > 0 and max(${schema.orders.paidAt}) < ${since}`
        : opts.filter === "never"
          ? sql`${paidCount} = 0`
          : undefined;
  return db
    .select({
      id: schema.customers.id,
      email: schema.customers.email,
      name: schema.customers.name,
      createdAt: schema.customers.createdAt,
      lastSignInAt: schema.customers.lastSignInAt,
      acceptsMarketing: schema.customers.acceptsMarketing,
      tags: schema.customers.tags,
      orders: sql<number>`count(${schema.orders.id}) filter (where ${schema.orders.paymentStatus} in ${PAID_SQL})`.mapWith(Number).as("orders"),
      spentMinor: sql<number>`coalesce(sum(${schema.orders.totalMinor} - ${schema.orders.refundedMinor}) filter (where ${schema.orders.paymentStatus} in ${PAID_SQL}), 0)`.mapWith(Number).as("spent_minor"),
      lastOrderAt: sql<Date | null>`max(${schema.orders.paidAt})`.mapWith((v) => (v ? new Date(v) : null)).as("last_order_at"),
    })
    .from(schema.customers)
    .leftJoin(schema.orders, and(eq(schema.orders.shopId, schema.customers.shopId), eq(schema.orders.email, schema.customers.email)))
    .where(
      and(
        eq(schema.customers.shopId, shopId),
        q ? sql`(lower(${schema.customers.email}) like ${`%${q}%`} or lower(coalesce(${schema.customers.name}, '')) like ${`%${q}%`})` : undefined,
        tag ? sql`${schema.customers.tags} @> ${JSON.stringify([tag])}::jsonb` : undefined,
        opts.filter === "subscribed" ? eq(schema.customers.acceptsMarketing, true) : undefined,
      ),
    )
    .groupBy(schema.customers.id)
    .having(
      and(
        // Leaves out addresses that only asked for the newsletter and never confirmed or bought.
        sql`(count(${schema.orders.id}) > 0 or bool_or(${schema.customers.acceptsMarketing}) or max(${schema.customers.lastSignInAt}) is not null or max(${schema.customers.name}) is not null or bool_or(${schema.customers.wholesaleStatus} = 'approved') or max(jsonb_array_length(${schema.customers.tags})) > 0)`,
        filter,
        country ? sql`bool_or(${schema.orders.shippingAddress}->>'country' = ${country} and ${schema.orders.paymentStatus} in ${PAID_SQL})` : undefined,
      ),
    );
}

/** Countries customers bought for, with how many buyers each, most first. For the customer list's country menu. */
export async function customerCountries(db: Db, shopId: string) {
  const country = sql<string>`${schema.orders.shippingAddress}->>'country'`;
  const rows = await db
    .select({ country, count: sql<number>`count(distinct ${schema.orders.email})::int` })
    .from(schema.orders)
    .where(and(eq(schema.orders.shopId, shopId), sql`${schema.orders.paymentStatus} in ${PAID_SQL}`))
    .groupBy(country)
    .orderBy(sql`count(distinct ${schema.orders.email}) desc`, country);
  return rows.filter((r) => r.country && /^[A-Z]{2}$/.test(r.country));
}

/** Customers on one page of the customer list. */
export const CUSTOMER_PAGE_SIZE = 100;

/** Orders for the customer list: last order (the default), most spent, most orders, newest, or name. */
export const CUSTOMER_SORTS = ["recent", "spent", "orders", "newest", "name"] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

function customerOrder(sort: CustomerSort) {
  const c = schema.customers;
  const paid = sql`${schema.orders.paymentStatus} in ${PAID_SQL}`;
  switch (sort) {
    case "spent":
      return [sql`coalesce(sum(${schema.orders.totalMinor} - ${schema.orders.refundedMinor}) filter (where ${paid}), 0) desc`];
    case "orders":
      return [sql`count(${schema.orders.id}) filter (where ${paid}) desc`, sql`max(${schema.orders.paidAt}) desc nulls last`];
    case "newest":
      return [desc(c.createdAt)];
    // Customers without a name go after the named ones, by email.
    case "name":
      return [sql`lower(${c.name}) asc nulls last`, c.email];
    default:
      return [sql`max(${schema.orders.paidAt}) desc nulls last`];
  }
}

/** Customers for the merchant: who bought, how often, how much and when last. Latest buyers first. */
export async function listCustomers(db: Db, shopId: string, opts: CustomerQuery & { sort?: CustomerSort; limit?: number; offset?: number } = {}) {
  return customerRows(db, shopId, opts)
    .orderBy(...customerOrder(opts.sort ?? "recent"), desc(schema.customers.createdAt), schema.customers.id)
    .limit(opts.limit ?? 500)
    .offset(opts.offset ?? 0);
}

/** How many customers match, how many bought more than once and how many signed in, over all of them, not one page. */
export async function customerTotals(db: Db, shopId: string, opts: CustomerQuery = {}) {
  const rows = customerRows(db, shopId, opts).as("c");
  const [row] = await db
    .select({
      customers: sql<number>`count(*)::int`,
      repeat: sql<number>`count(*) filter (where ${rows.orders} > 1)::int`,
      accounts: sql<number>`count(*) filter (where ${rows.lastSignInAt} is not null)::int`,
    })
    .from(rows);
  return row!;
}

/** The most customers one "tag everyone in this list" can change. */
export const MAX_TAG_ALL = 10_000;

/**
 * Adds or removes a tag on every customer the list shows for this search, tag and filter (all
 * pages). Customers who already have the tag, or already have the most tags, are left as they are.
 */
export async function tagCustomers(db: Db, shopId: string, list: CustomerQuery, input: { tag: string; remove?: boolean }) {
  if (input.tag.includes(",")) throw new UserError("Add one tag at a time.");
  const [tag] = normalizeTags(input.tag, "A customer", 1);
  if (!tag) throw new UserError("Enter the tag, like vip.");
  const rows = await customerRows(db, shopId, list).limit(MAX_TAG_ALL + 1);
  if (rows.length > MAX_TAG_ALL) throw new UserError(`That's more than ${MAX_TAG_ALL.toLocaleString("en-US")} customers. Narrow the list with a search or filter first.`);
  const ids = rows.map((r) => r.id);
  if (!ids.length) return { tag, changed: 0, full: 0 };
  const has = sql`${schema.customers.tags} @> ${JSON.stringify([tag])}::jsonb`;
  const t = schema.customers;
  if (input.remove) {
    // A rule tag taken off by hand is no longer tracked, as on the customer's page.
    const changed = await db
      .update(t)
      .set({ tags: sql`${t.tags} - ${tag}::text`, autoTags: sql`${t.autoTags} - ${tag}::text` })
      .where(and(eq(t.shopId, shopId), inArray(t.id, ids), has))
      .returning({ id: t.id });
    return { tag, changed: changed.length, full: 0 };
  }
  const changed = await db
    .update(t)
    .set({ tags: sql`${t.tags} || ${JSON.stringify([tag])}::jsonb` })
    .where(and(eq(t.shopId, shopId), inArray(t.id, ids), sql`not ${has}`, sql`jsonb_array_length(${t.tags}) < ${MAX_TAGS}`))
    .returning({ id: t.id });
  const [full] = await db
    .select({ n: count() })
    .from(t)
    .where(and(inArray(t.id, ids), sql`not ${has}`, sql`jsonb_array_length(${t.tags}) >= ${MAX_TAGS}`));
  return { tag, changed: changed.length, full: Number(full?.n ?? 0) };
}

/** Old codes and expired buyer sessions are dropped by the scheduled job. */
export async function pruneBuyerRecords(db: Db, now = new Date()) {
  await db.delete(schema.buyerCodes).where(lt(schema.buyerCodes.expiresAt, new Date(now.getTime() - 1440 * MINUTE)));
  await db.delete(schema.buyerSessions).where(lt(schema.buyerSessions.expiresAt, now));
}
