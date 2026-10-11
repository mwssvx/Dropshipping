// Badges on product cards: a label of the merchant's own ("Bestseller", "Limited edition") and
// automatic ones the store works out, so they're never wrong: how much is off when a product is on
// sale, "Sold out" when nothing can be ordered, and "New" for a while after it was added. A card
// shows two at most, the merchant's own first.
import { and, eq } from "drizzle-orm";
import { schema, type BadgeSettings, type Db } from "@sf/db";
import { BADGE_MAX_LENGTH } from "./badge-rules";
import { NotFoundError, UserError } from "./errors";
import { openPreorder } from "./preorders";

export { BADGE_MAX_LENGTH, cardBadges, DEFAULT_BADGES, type Badge, type BadgeFacts } from "./badge-rules";
const MAX_NEW_DAYS = 90;

/** Nothing can be ordered: every option is out of stock and there's no open pre-order. */
export function productSoldOut(p: Parameters<typeof openPreorder>[0] & { variants: { stock: number | null }[] }, now = new Date()) {
  return !openPreorder(p, now) && p.variants.length > 0 && p.variants.every((v) => v.stock !== null && v.stock <= 0);
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
