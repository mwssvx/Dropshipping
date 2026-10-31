// Badges on product cards: a label of the merchant's own ("Bestseller", "Limited edition") and
// automatic ones the store works out, so they're never wrong: how much is off when a product is on
// sale, "Sold out" when nothing can be ordered, and "New" for a while after it was added. A card
// shows two at most, the merchant's own first. Also where sold-out products sit in lists.
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { schema, SOLD_OUT_DISPLAY, type BadgeSettings, type Db, type SoldOutDisplay } from "@sf/db";
import { BADGE_MAX_LENGTH } from "./badge-rules";
import { NotFoundError, UserError } from "./errors";
import { openPreorder } from "./preorders";

export { BADGE_MAX_LENGTH, cardBadges, DEFAULT_BADGES, type Badge, type BadgeFacts } from "./badge-rules";
const MAX_NEW_DAYS = 90;

/** Nothing can be ordered: every option is out of stock and there's no open pre-order. */
export function productSoldOut(p: Parameters<typeof openPreorder>[0] & { variants: { stock: number | null }[] }, now = new Date()) {
  return !openPreorder(p, now) && p.variants.length > 0 && p.variants.every((v) => v.stock !== null && v.stock <= 0);
}

/**
 * The one option a product card can add to the cart straight away, or null when the buyer has
 * something to choose or type first: more than one option, personalisation, at least two to order,
 * or none left to sell.
 */
export function quickAddVariant(p: {
  variants: { id: string; stock: number | null }[];
  personalization?: unknown[] | null;
  purchaseLimit?: { min: number | null } | null;
}) {
  const [only, ...rest] = p.variants;
  if (!only || rest.length || p.personalization?.length || (p.purchaseLimit?.min ?? 1) > 1) return null;
  return only.stock === null || only.stock > 0 ? only.id : null;
}

/** Most options a product card lists in its picker; with more, the product page is the better place to choose. */
export const QUICK_PICK_MAX = 12;

/**
 * The options a product card can list in a small picker next to "Add to cart": two to 12, all at
 * one price (so the card's price holds for each), nothing to type and no minimum above one. Sold
 * out options are listed but can't be picked. Null otherwise, or when none are left.
 */
export function quickPickOptions(p: {
  variants: { id: string; title: string; priceMinor: number; stock: number | null }[];
  personalization?: unknown[] | null;
  purchaseLimit?: { min: number | null } | null;
}) {
  const v = p.variants;
  if (v.length < 2 || v.length > QUICK_PICK_MAX || p.personalization?.length || (p.purchaseLimit?.min ?? 1) > 1) return null;
  if (v.some((x) => x.priceMinor !== v[0]!.priceMinor)) return null;
  const options = v.map((x) => ({ id: x.id, title: x.title, soldOut: x.stock !== null && x.stock <= 0 }));
  return options.some((o) => !o.soldOut) ? options : null;
}

/** Whether product cards carry an "Add to cart" button for products with nothing to choose. */
export async function setCardQuickAdd(db: Db, shopId: string, on: boolean) {
  await db.update(schema.shops).set({ cardQuickAdd: on, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return on;
}

/** Whether "Add to cart" keeps the shopper on the page they were on, with a note, instead of opening the cart. */
export async function setStayAfterAdd(db: Db, shopId: string, on: boolean) {
  await db.update(schema.shops).set({ stayAfterAdd: on, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return on;
}

/** Whether product pages show share buttons. */
export async function setShareButtons(db: Db, shopId: string, on: boolean) {
  await db.update(schema.shops).set({ shareButtons: on, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return on;
}

/** Whether product pages say how many sold lately. */
export async function setRecentSales(db: Db, shopId: string, on: boolean) {
  await db.update(schema.shops).set({ recentSales: on, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return on;
}

/** Days "sold in the last N days" counts. */
export const RECENT_SALES_DAYS = 7;
/** Fewer sales than this aren't shown: "1 sold" helps nobody. */
export const RECENT_SALES_MIN = 3;

/**
 * Units of a product sold in paid orders over the last week, or null when it's fewer than
 * RECENT_SALES_MIN. Refunded orders don't count, so the number stays honest.
 */
export async function recentSalesCount(db: Db, shopId: string, productId: string, now = new Date()) {
  const since = new Date(now.getTime() - RECENT_SALES_DAYS * 86_400_000);
  const [row] = await db
    .select({ units: sql<number>`coalesce(sum(${schema.orderLines.quantity}), 0)::int` })
    .from(schema.orderLines)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
    .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .where(
      and(
        eq(schema.orders.shopId, shopId),
        inArray(schema.orders.paymentStatus, ["paid", "partially_refunded"]),
        eq(schema.variants.productId, productId),
        gte(schema.orders.paidAt, since),
      ),
    );
  const units = Number(row?.units ?? 0);
  return units >= RECENT_SALES_MIN ? units : null;
}

/** Which automatic badges the store's product cards show. */
export async function setBadgeSettings(db: Db, shopId: string, input: BadgeSettings) {
  const newDays = Number(input.newDays);
  if (!Number.isInteger(newDays) || newDays < 0 || newDays > MAX_NEW_DAYS) throw new UserError(`Show "New" for 0 to ${MAX_NEW_DAYS} days (0 turns it off).`);
  const settings: BadgeSettings = { sale: !!input.sale, soldOut: !!input.soldOut, newDays };
  await db.update(schema.shops).set({ productBadges: settings, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return settings;
}

/** The merchant's own label on a product's card, or none when empty. */
export async function setProductBadge(db: Db, shopId: string, productId: string, text: string | null) {
  const badge = (text ?? "").replace(/\s+/g, " ").trim() || null;
  if (badge && badge.length > BADGE_MAX_LENGTH) throw new UserError(`Keep the badge to ${BADGE_MAX_LENGTH} characters, so it fits on the card.`);
  const [row] = await db
    .update(schema.products)
    .set({ badge, updatedAt: new Date() })
    .where(and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)))
    .returning({ id: schema.products.id });
  if (!row) throw new NotFoundError("Product");
  return badge;
}

/**
 * A list with its sold-out products where the store wants them: left in place, moved after
 * everything that can be bought (each part keeps its order), or left out.
 */
export function placeSoldOut<T>(items: T[], mode: SoldOutDisplay, soldOut: (item: T) => boolean) {
  if (mode === "show") return items;
  const available = items.filter((i) => !soldOut(i));
  return mode === "hide" ? available : [...available, ...items.filter(soldOut)];
}

/** Where a store lists its sold-out products. */
export async function soldOutDisplay(db: Db, shopId: string): Promise<SoldOutDisplay> {
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId), columns: { soldOutProducts: true } });
  return shop?.soldOutProducts ?? "last";
}

export async function setSoldOutDisplay(db: Db, shopId: string, mode: string) {
  if (!(SOLD_OUT_DISPLAY as readonly string[]).includes(mode)) throw new UserError("Pick where sold-out products go.");
  await db.update(schema.shops).set({ soldOutProducts: mode as SoldOutDisplay, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return mode as SoldOutDisplay;
}
