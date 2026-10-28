// Saved items: buyers keep products for later. Guests keep a list in a cookie; signed-in buyers
// keep theirs on their account, and get one email when something they saved gets cheaper.
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import type { Mailer } from "./email";
import { NotFoundError, UserError } from "./errors";
import { formatMoney } from "./money";
import { productPhotos } from "./gallery";
import { salePrice, salesFor, type SaleInfo } from "./sales";

type Shop = typeof schema.shops.$inferSelect;
type Variant = typeof schema.variants.$inferSelect;
const DAY = 86_400_000;
export const MAX_SAVED = 50;

/** What the product costs now: the cheapest option that can be bought, or the cheapest at all. */
export function lowestPrice(variants: Pick<Variant, "priceMinor" | "stock">[]) {
  const buyable = variants.filter((v) => v.stock === null || v.stock > 0);
  const pool = buyable.length ? buyable : variants;
  return pool.length ? Math.min(...pool.map((v) => v.priceMinor)) : null;
}

async function activeProducts(db: Db, shopId: string, ids: string[]) {
  if (!ids.length) return [];
  const products = await db.query.products.findMany({
    where: and(eq(schema.products.shopId, shopId), inArray(schema.products.id, ids), eq(schema.products.status, "active")),
  });
  const variants = products.length ? await db.query.variants.findMany({ where: inArray(schema.variants.productId, products.map((p) => p.id)) }) : [];
  return products.map((p) => {
    const vs = variants.filter((v) => v.productId === p.id);
    return { product: p, priceMinor: lowestPrice(vs), soldOut: vs.every((v) => v.stock !== null && v.stock <= 0) };
  });
}

/** Clean product ids from a cookie: unique, uuid-shaped, newest kept. */
export function savedIdsFrom(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x));
  return [...new Set(ids)].slice(-MAX_SAVED);
}

/** Saves a product to a signed-in buyer's list, remembering today's price. */
export async function saveItem(db: Db, shopId: string, customerId: string, productId: string, now = new Date()) {
  const [found] = await activeProducts(db, shopId, [productId]);
  if (!found || found.priceMinor === null) throw new NotFoundError("Product");
  // Saved during a sale: the sale price is what they saw, so only a lower one counts as a drop.
  const price = salePrice(found.priceMinor, null, (await salesFor(db, shopId, [productId], now)).get(productId)).priceMinor;
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(schema.savedItems).where(eq(schema.savedItems.customerId, customerId));
  if (n >= MAX_SAVED) throw new UserError(`You can save up to ${MAX_SAVED} items. Remove one to save another.`);
  await db.insert(schema.savedItems).values({ shopId, customerId, productId, priceMinor: price, alertPriceMinor: price, createdAt: now }).onConflictDoNothing();
}

export async function unsaveItem(db: Db, customerId: string, productId: string) {
  await db.delete(schema.savedItems).where(and(eq(schema.savedItems.customerId, customerId), eq(schema.savedItems.productId, productId)));
}

/** A guest's saved list joins their account when they sign in. */
export async function mergeSaved(db: Db, shopId: string, customerId: string, productIds: string[], now = new Date()) {
  for (const id of savedIdsFrom(productIds)) {
    try {
      await saveItem(db, shopId, customerId, id, now);
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
    }
  }
}

export async function savedProductIds(db: Db, customerId: string) {
  const rows = await db.query.savedItems.findMany({ where: eq(schema.savedItems.customerId, customerId), orderBy: desc(schema.savedItems.createdAt), columns: { productId: true } });
  return rows.map((r) => r.productId);
}

/**
 * The Saved page: products still on sale, newest first, with the price now and, for signed-in
 * buyers, the price when they saved it.
 */
export async function listSaved(db: Db, shopId: string, who: { customerId: string } | { productIds: string[] }) {
  const rows =
    "customerId" in who
      ? await db.query.savedItems.findMany({ where: and(eq(schema.savedItems.customerId, who.customerId), eq(schema.savedItems.shopId, shopId)), orderBy: desc(schema.savedItems.createdAt) })
      : savedIdsFrom(who.productIds).reverse().map((productId) => ({ productId, priceMinor: null as number | null }));
  const found = new Map((await activeProducts(db, shopId, rows.map((r) => r.productId))).map((f) => [f.product.id, f]));
  return rows.flatMap((r) => {
    const f = found.get(r.productId);
    if (!f || f.priceMinor === null) return [];
    return [{
      id: f.product.id,
      handle: f.product.handle,
      title: f.product.title,
      imageUrl: productPhotos(f.product)[0] ?? null,
      priceMinor: f.priceMinor,
      savedPriceMinor: r.priceMinor,
      soldOut: f.soldOut,
    }];
  });
}

/**
 * Sharing: a signed-in buyer gets a link to their saved list, so a friend can see it (to buy a
 * gift, say). The link is a long random token; turning sharing off forgets it, so an old link
 * stops working, and sharing again makes a new one.
 */
export async function shareSaved(db: Db, shopId: string, customerId: string) {
  const where = and(eq(schema.customers.id, customerId), eq(schema.customers.shopId, shopId));
  const customer = await db.query.customers.findFirst({ where, columns: { savedShareToken: true } });
  if (!customer) throw new NotFoundError("Customer");
  if (customer.savedShareToken) return customer.savedShareToken;
  await db.update(schema.customers).set({ savedShareToken: randomBytes(18).toString("base64url") }).where(and(where, isNull(schema.customers.savedShareToken)));
  // Pressed twice at once: the first token stays.
  return (await db.query.customers.findFirst({ where, columns: { savedShareToken: true } }))!.savedShareToken!;
}

export async function stopSharingSaved(db: Db, shopId: string, customerId: string) {
  await db.update(schema.customers).set({ savedShareToken: null }).where(and(eq(schema.customers.id, customerId), eq(schema.customers.shopId, shopId)));
}

/**
 * The list behind a share link, or null when the link is wrong or sharing is off. Friends see the
 * products and today's prices, but not the buyer's email or what the prices were when they saved.
 */
export async function sharedSaved(db: Db, shopId: string, token: string) {
  if (!/^[\w-]{20,40}$/.test(token)) return null;
  const customer = await db.query.customers.findFirst({
    where: and(eq(schema.customers.shopId, shopId), eq(schema.customers.savedShareToken, token)),
    columns: { id: true, name: true },
  });
  if (!customer) return null;
  const items = (await listSaved(db, shopId, { customerId: customer.id })).map(({ savedPriceMinor: _, ...item }) => item);
  return { firstName: customer.name?.trim().split(/\s+/)[0] || null, items };
}

/** How many buyers saved each product, most saved first, for the merchant. */
export async function mostSaved(db: Db, shopId: string, limit = 10) {
  return db
    .select({ productId: schema.products.id, title: schema.products.title, saved: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.savedItems)
    .innerJoin(schema.products, eq(schema.products.id, schema.savedItems.productId))
    .where(eq(schema.savedItems.shopId, shopId))
    .groupBy(schema.products.id, schema.products.title)
    .orderBy(sql`count(*) desc`, asc(schema.products.title))
    .limit(limit);
}

export async function savedCount(db: Db, shopId: string, productId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.savedItems)
    .where(and(eq(schema.savedItems.shopId, shopId), eq(schema.savedItems.productId, productId)));
  return row?.n ?? 0;
}

export async function setPriceAlerts(db: Db, shopId: string, customerId: string, on: boolean) {
  await db.update(schema.customers).set({ priceAlerts: on }).where(and(eq(schema.customers.id, customerId), eq(schema.customers.shopId, shopId)));
}

export type PriceDropContext = {
  db: Db;
  mailer: Mailer;
  /** The store's public address, with no trailing slash. */
  storeAddress: (shop: Shop) => string | Promise<string>;
  now?: () => Date;
};

/**
 * Emails buyers whose saved items got cheaper than when they saved them (or than the last drop we
 * told them about). One email per buyer lists every drop, and a buyer hears at most once a day.
 */
export async function sendPriceDrops(ctx: PriceDropContext, scope: { shopId?: string; limit?: number } = {}) {
  const { db } = ctx;
  const now = ctx.now?.() ?? new Date();
  const rows = await db
    .select({ item: schema.savedItems, customer: { id: schema.customers.id, email: schema.customers.email }, product: { id: schema.products.id, title: schema.products.title, handle: schema.products.handle } })
    .from(schema.savedItems)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.savedItems.customerId))
    .innerJoin(schema.products, eq(schema.products.id, schema.savedItems.productId))
    .where(
      and(
        eq(schema.customers.priceAlerts, true),
        eq(schema.products.status, "active"),
        or(isNull(schema.savedItems.lastAlertAt), lt(schema.savedItems.lastAlertAt, new Date(now.getTime() - DAY))),
        scope.shopId ? eq(schema.savedItems.shopId, scope.shopId) : undefined,
      ),
    )
    .limit(scope.limit ?? 2000);
  if (!rows.length) return { sent: 0 };
  const variants = await db.query.variants.findMany({ where: inArray(schema.variants.productId, [...new Set(rows.map((r) => r.product.id))]) });
  // A sale starting counts as a drop.
  const sales = new Map<string, SaleInfo>();
  for (const shopId of new Set(rows.map((r) => r.item.shopId))) {
    for (const [id, sale] of await salesFor(db, shopId, rows.filter((r) => r.item.shopId === shopId).map((r) => r.product.id), now)) sales.set(id, sale);
  }
  const priceOf = new Map<string, number | null>();
  for (const id of new Set(rows.map((r) => r.product.id))) {
    const vs = variants.filter((v) => v.productId === id && (v.stock === null || v.stock > 0));
    priceOf.set(id, vs.length ? Math.min(...vs.map((v) => salePrice(v.priceMinor, null, sales.get(id)).priceMinor)) : null); // sold out: no point telling them
  }
  // Group the drops by buyer, so each gets one email.
  const byBuyer = new Map<string, { shopId: string; email: string; customerId: string; drops: { itemId: string; title: string; handle: string; was: number; now: number }[] }>();
  const recentlyTold = new Set(
    (await db.query.savedItems.findMany({ where: and(inArray(schema.savedItems.customerId, [...new Set(rows.map((r) => r.customer.id))]), sql`${schema.savedItems.lastAlertAt} > ${new Date(now.getTime() - DAY)}`), columns: { customerId: true } })).map((r) => r.customerId),
  );
  for (const r of rows) {
    const price = priceOf.get(r.product.id);
    if (price == null || recentlyTold.has(r.customer.id)) continue;
    // At least 1% cheaper, so rounding changes don't send email.
    const ref = r.item.alertPriceMinor;
    if (price >= ref || ref - price < Math.max(1, Math.round(ref * 0.01))) continue;
    const entry = byBuyer.get(r.customer.id) ?? { shopId: r.item.shopId, email: r.customer.email, customerId: r.customer.id, drops: [] };
    entry.drops.push({ itemId: r.item.id, title: r.product.title, handle: r.product.handle, was: ref, now: price });
    byBuyer.set(r.customer.id, entry);
  }
  const shops = new Map<string, Shop>();
  let sent = 0;
  for (const b of byBuyer.values()) {
    let shop = shops.get(b.shopId);
    if (!shop) {
      shop = (await db.query.shops.findFirst({ where: eq(schema.shops.id, b.shopId) }))!;
      shops.set(shop.id, shop);
    }
    // Claim the items first, so two runs at once don't both send.
    const claimed = await db
      .update(schema.savedItems)
      .set({ lastAlertAt: now })
      .where(and(inArray(schema.savedItems.id, b.drops.map((d) => d.itemId)), or(isNull(schema.savedItems.lastAlertAt), lt(schema.savedItems.lastAlertAt, new Date(now.getTime() - DAY)))))
      .returning({ id: schema.savedItems.id });
    const mine = b.drops.filter((d) => claimed.some((c) => c.id === d.itemId));
    if (!mine.length) continue;
    const address = await ctx.storeAddress(shop);
    const money = (m: number) => formatMoney(m, shop.currency);
    try {
      await ctx.mailer.send({
        to: b.email,
        subject: mine.length === 1 ? `Price drop: ${mine[0]!.title}` : `${mine.length} things you saved are cheaper`,
        text: [
          `Hi,`,
          ``,
          mine.length === 1 ? `Something you saved at ${shop.name} costs less now:` : `Some things you saved at ${shop.name} cost less now:`,
          ``,
          ...mine.map((d) => `${d.title}: ${money(d.now)} (was ${money(d.was)})\n${address}/products/${d.handle}`),
          ``,
          `See everything you saved: ${address}/saved`,
          ``,
          `You get these because you saved these items. Turn them off on your Saved page.`,
        ].join("\n"),
      });
      sent++;
      // The new price is what the next drop is measured against.
      for (const d of mine) await db.update(schema.savedItems).set({ alertPriceMinor: d.now }).where(eq(schema.savedItems.id, d.itemId));
    } catch {
      await db.update(schema.savedItems).set({ lastAlertAt: null }).where(inArray(schema.savedItems.id, mine.map((d) => d.itemId)));
    }
  }
  return { sent };
}
