// Badges on product cards: a label of the merchant's own ("Bestseller", "Limited edition") and
// automatic ones the store works out, so they're never wrong: how much is off when a product is on
// sale, "Sold out" when nothing can be ordered, and "New" for a while after it was added. A card
// shows two at most, the merchant's own first. Also where sold-out products sit in lists.
import { and, eq } from "drizzle-orm";
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

/** Whether product cards carry an "Add to cart" button for products with nothing to choose. */
export async function setCardQuickAdd(db: Db, shopId: string, on: boolean) {
  await db.update(schema.shops).set({ cardQuickAdd: on, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return on;
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
