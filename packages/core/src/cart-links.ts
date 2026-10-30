// Cart links: one link that fills a shopper's cart with chosen products, and a code if the merchant
// picks one, so a DM, an ad or a creator's post goes straight to a ready cart. Shopify has these as
// "cart permalinks" that are typed by hand; here they're made from a form and counted. Clicks are
// counted on the link; orders and sales are those whose visit came in through it (its source).
import { randomBytes } from "node:crypto";
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { utmSourceOf } from "./analytics";

export const CART_LINK_MAX_LINES = 10;
export const CART_LINKS_MAX = 100;
const PAID = ["paid", "partially_refunded", "refunded"] as const;

/** What a link's visits are recorded as, for analytics and its order count: "link-" and its name. */
export const cartLinkSource = (name: string) => utmSourceOf(`link-${name}`)!;

type LinkInput = { name: string; lines: { variantId: string; quantity: number }[]; discountCode?: string | null };

export async function createCartLink(db: Db, shopId: string, input: LinkInput) {
  const name = input.name.trim();
  if (!name) throw new UserError("Give the link a name, like Instagram bundle.");
  if (name.length > 60) throw new UserError("Keep the name under 60 characters.");
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(schema.cartLinks).where(eq(schema.cartLinks.shopId, shopId));
  if (n >= CART_LINKS_MAX) throw new UserError(`A store can keep up to ${CART_LINKS_MAX} cart links. Delete an old one first.`);
  const existing = await db.query.cartLinks.findMany({ where: eq(schema.cartLinks.shopId, shopId), columns: { name: true } });
  if (existing.some((l) => cartLinkSource(l.name) === cartLinkSource(name))) throw new UserError(`You already have a link called "${name}". Pick another name, so their sales stay apart.`);

  // The same option twice is one line with both quantities.
  const merged = new Map<string, number>();
  for (const l of input.lines) {
    if (!l.variantId) continue;
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 99) throw new UserError("Each quantity is a whole number from 1 to 99.");
    merged.set(l.variantId, Math.min(99, (merged.get(l.variantId) ?? 0) + l.quantity));
  }
  if (!merged.size) throw new UserError("Pick at least one product for the cart.");
  if (merged.size > CART_LINK_MAX_LINES) throw new UserError(`A cart link holds up to ${CART_LINK_MAX_LINES} products.`);
  const variants = await db
    .select({ id: schema.variants.id, status: schema.products.status, giftCard: schema.products.giftCard })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(eq(schema.products.shopId, shopId), inArray(schema.variants.id, [...merged.keys()])));
  if (variants.length !== merged.size) throw new NotFoundError("Product");
  if (variants.some((v) => v.giftCard)) throw new UserError("Gift cards can't go in a cart link, since each one needs its own details.");
  if (variants.some((v) => v.status === "archived")) throw new UserError("One of those products is archived. Put it back on sale first.");

  let code: string | null = null;
  if (input.discountCode?.trim()) {
    code = input.discountCode.trim().toUpperCase();
    const d = await db.query.discounts.findFirst({ where: and(eq(schema.discounts.shopId, shopId), eq(schema.discounts.code, code)) });
    if (!d) throw new UserError(`There's no code ${code} in your store.`);
  }
  const [row] = await db
    .insert(schema.cartLinks)
    .values({ shopId, name, token: randomBytes(6).toString("base64url"), lines: [...merged].map(([variantId, quantity]) => ({ variantId, quantity })), discountCode: code })
    .returning();
  return row!;
}

export async function deleteCartLink(db: Db, shopId: string, id: string) {
  await db.delete(schema.cartLinks).where(and(eq(schema.cartLinks.id, id), eq(schema.cartLinks.shopId, shopId)));
}

/** The store's cart links, newest first, with what's in them and what they sold. */
export async function listCartLinks(db: Db, shopId: string) {
  const links = await db.query.cartLinks.findMany({ where: eq(schema.cartLinks.shopId, shopId), orderBy: desc(schema.cartLinks.createdAt) });
  if (!links.length) return [];
  const ids = [...new Set(links.flatMap((l) => l.lines.map((x) => x.variantId)))];
  const variants = ids.length
    ? await db
        .select({ id: schema.variants.id, title: schema.variants.title, product: schema.products.title, status: schema.products.status })
        .from(schema.variants)
        .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
        .where(inArray(schema.variants.id, ids))
    : [];
  const sources = links.map((l) => cartLinkSource(l.name));
  const sold = await db
    .select({ source: schema.orders.visitSource, orders: count(), salesMinor: sql<number>`sum(${schema.orders.totalMinor} - ${schema.orders.refundedMinor})::bigint` })
    .from(schema.orders)
    .where(and(eq(schema.orders.shopId, shopId), inArray(schema.orders.visitSource, sources), inArray(schema.orders.paymentStatus, [...PAID]), ne(schema.orders.source, "replacement")))
    .groupBy(schema.orders.visitSource);
  return links.map((l) => {
    const source = cartLinkSource(l.name);
    const s = sold.find((x) => x.source === source);
    return {
      ...l,
      source,
      items: l.lines.map((x) => {
        const v = variants.find((y) => y.id === x.variantId);
        return { quantity: x.quantity, title: v ? (v.title && v.title !== "Default" ? `${v.product} – ${v.title}` : v.product) : "A deleted product", onSale: v?.status === "active" };
      }),
      orders: Number(s?.orders ?? 0),
      salesMinor: Number(s?.salesMinor ?? 0),
    };
  });
}

/**
 * A shopper opens a link: its click is counted, and back come the lines still for sale (products
 * on sale, options in stock or not tracked), its code and its source. Null for a link that's gone.
 */
export async function openCartLink(db: Db, shopId: string, token: string) {
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(token)) return null;
  const [link] = await db
    .update(schema.cartLinks)
    .set({ clicks: sql`${schema.cartLinks.clicks} + 1` })
    .where(and(eq(schema.cartLinks.shopId, shopId), eq(schema.cartLinks.token, token)))
    .returning();
  if (!link) return null;
  const ids = link.lines.map((l) => l.variantId);
  const live = await db
    .select({ id: schema.variants.id, stock: schema.variants.stock })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(inArray(schema.variants.id, ids), eq(schema.products.status, "active")));
  const lines = link.lines.filter((l) => live.some((v) => v.id === l.variantId && (v.stock === null || v.stock > 0)));
  return { lines, discountCode: link.discountCode, source: cartLinkSource(link.name) };
}

/** Products a link can hold (on sale or still a draft, no gift cards), each with its options. */
export async function cartLinkChoices(db: Db, shopId: string) {
  const rows = await db
    .select({ productId: schema.products.id, product: schema.products.title, status: schema.products.status, id: schema.variants.id, title: schema.variants.title })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(eq(schema.products.shopId, shopId), ne(schema.products.status, "archived"), eq(schema.products.giftCard, false)))
    .orderBy(schema.products.title, schema.variants.position);
  const out: { id: string; title: string; draft: boolean; variants: { id: string; title: string }[] }[] = [];
  for (const r of rows) {
    let p = out.find((x) => x.id === r.productId);
    if (!p) out.push((p = { id: r.productId, title: r.product, draft: r.status === "draft", variants: [] }));
    p.variants.push({ id: r.id, title: r.title });
  }
  return out;
}
