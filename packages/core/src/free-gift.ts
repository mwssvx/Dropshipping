// A free gift with orders over an amount ("Spend $75, get a tote bag free"). Other platforms sell
// this as an app. The cart says how much more it takes, and once the order is over the amount the
// gift is added as a free line, so it's sent with the order like anything else and its stock and
// cost count. The amount is what the buyer pays for goods, after discounts. Wholesale orders,
// after-checkout offers and repeat deliveries don't get one.
import { and, asc, eq, ne } from "drizzle-orm";
import { schema, type Db, type FreeGift } from "@sf/db";
import { UserError } from "./errors";

type Shop = Pick<typeof schema.shops.$inferSelect, "id" | "freeGift">;

/** The most an order can need for a gift: 10,000 in the store's currency. */
export const MAX_FREE_GIFT_MINOR = 1_000_000;

export const FREE_GIFT_NOTE = "free gift";

/** Options the merchant can give away: anything on sale or in draft, except gift cards. */
export async function freeGiftChoices(db: Db, shopId: string) {
  const rows = await db
    .select({ id: schema.variants.id, variant: schema.variants.title, product: schema.products.title })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(eq(schema.products.shopId, shopId), ne(schema.products.status, "archived"), eq(schema.products.giftCard, false)))
    .orderBy(asc(schema.products.title), asc(schema.variants.position));
  return rows.map((r) => ({ id: r.id, title: r.variant === "Default" ? r.product : `${r.product} – ${r.variant}` }));
}

/** Sets the gift and the amount an order needs for it, or turns it off (null). */
export async function setFreeGift(db: Db, shopId: string, input: { variantId: string; minSubtotalMinor: number } | null) {
  let value: FreeGift | null = null;
  if (input) {
    if (!Number.isInteger(input.minSubtotalMinor) || input.minSubtotalMinor < 1 || input.minSubtotalMinor > MAX_FREE_GIFT_MINOR) {
      throw new UserError("Enter an order amount between 0.01 and 10,000.");
    }
    if (!(await freeGiftChoices(db, shopId)).some((c) => c.id === input.variantId)) throw new UserError("Pick a product from your store to give away.");
    value = { variantId: input.variantId, minSubtotalMinor: input.minSubtotalMinor };
  }
  await db.update(schema.shops).set({ freeGift: value, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return value;
}

export type FreeGiftOffer = {
  variantId: string;
  productHandle: string;
  title: string;
  imageUrl: string | null;
  unitCostMinor: number | null;
  minSubtotalMinor: number;
  /** The order is over the amount, so the gift comes with it. */
  unlocked: boolean;
  /** How much more the buyer needs to spend on goods; 0 once unlocked. */
  moreMinor: number;
};

/**
 * The store's gift for a cart whose goods come to `paidMinor` after discounts. Null when there's no
 * gift, or it can't be given: the product isn't on sale, it's sold out, or it can't go to `country`.
 */
export async function freeGiftFor(db: Db, shop: Shop, paidMinor: number, country: string | null): Promise<FreeGiftOffer | null> {
  const gift = shop.freeGift;
  if (!gift) return null;
  const [row] = await db
    .select({ variant: schema.variants, product: schema.products })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(eq(schema.variants.id, gift.variantId), eq(schema.products.shopId, shop.id)));
  if (!row || row.product.status !== "active" || row.product.giftCard) return null;
  if (row.variant.stock !== null && row.variant.stock < 1) return null;
  if (country && row.product.blockedCountries.includes(country)) return null;
  const title = row.variant.title === "Default" ? row.product.title : `${row.product.title} – ${row.variant.title}`;
  return {
    variantId: row.variant.id,
    productHandle: row.product.handle,
    title,
    imageUrl: row.variant.imageUrl ?? row.product.imageUrl,
    unitCostMinor: row.variant.costMinor,
    minSubtotalMinor: gift.minSubtotalMinor,
    unlocked: paidMinor >= gift.minSubtotalMinor,
    moreMinor: Math.max(0, gift.minSubtotalMinor - paidMinor),
  };
}
