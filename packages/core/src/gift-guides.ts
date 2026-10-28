// Gift guides: "Gifts under $25", "under $50" and "under $100" collections in one click. Each fills
// itself by rules (at most that price, in stock) and lists best sellers first, so it stays right as
// prices and stock change, and the store can show them on its home page or in the menu.
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { createCollection } from "./collections";
import { formatMoney } from "./money";

export const GIFT_GUIDE_AMOUNTS = [2500, 5000, 10000] as const;

type Shop = Pick<typeof schema.shops.$inferSelect, "id" | "currency">;

/** "$25" rather than "$25.00". */
const whole = (minor: number, currency: string) => formatMoney(minor, currency).replace(/[.,]00(?=\D*$)/, "");

/** The gift guides' titles in the store's currency, cheapest first. */
export const giftGuideTitles = (currency: string) => GIFT_GUIDE_AMOUNTS.map((a) => `Gifts under ${whole(a, currency)}`);

/** The gift guides the store already has, by title. */
export async function existingGiftGuides(db: Db, shop: Shop) {
  const rows = await db.query.collections.findMany({ where: and(eq(schema.collections.shopId, shop.id), inArray(schema.collections.title, giftGuideTitles(shop.currency))), columns: { id: true, title: true } });
  return rows;
}

/** Makes whichever gift guides the store doesn't have yet. */
export async function createGiftGuides(db: Db, shop: Shop) {
  const have = new Set((await existingGiftGuides(db, shop)).map((c) => c.title));
  const created = [];
  for (const amount of GIFT_GUIDE_AMOUNTS) {
    const title = `Gifts under ${whole(amount, shop.currency)}`;
    if (have.has(title)) continue;
    created.push(
      await createCollection(db, shop.id, {
        title,
        description: `Gift ideas at ${whole(amount, shop.currency)} or less, in stock and ready to send.`,
        rules: { match: "all", conditions: [{ kind: "price_at_most", minor: amount }, { kind: "in_stock" }] },
        sortOrder: "best_selling",
      }),
    );
  }
  return created;
}
