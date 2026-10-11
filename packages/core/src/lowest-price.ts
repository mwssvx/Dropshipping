// The lowest price before a discount. EU law (the Omnibus rule) says a reduced price must show the
// lowest price the product had in the 30 days before the reduction. A trigger on variants keeps
// every price an option has had (variant_prices); earlier sales count at what they charged.
// When the history doesn't reach back far enough to know, nothing is shown rather than a guess.
import { and, asc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { collectionMembership } from "./collections";
import { UserError } from "./errors";
import { CONSENT_COUNTRIES } from "./pixels";
import type { SaleInfo } from "./sales";
import { percentOff } from "./wholesale";

export const LOWEST_PRICE_DAYS = 30;
const DAY = 86_400_000;
export const LOWEST_PRICE_NOTES = ["eu", "everyone", "off"] as const;
export type LowestPriceNote = (typeof LOWEST_PRICE_NOTES)[number];

/** Whether this visitor sees the note: everyone, only visitors in Europe (where it's the law), or nobody. */
export function showsLowestPrice(setting: LowestPriceNote, country: string | null | undefined) {
  return setting === "everyone" || (setting === "eu" && !!country && CONSENT_COUNTRIES.has(country.toUpperCase()));
}

export async function setLowestPriceNote(db: Db, shopId: string, value: string) {
  if (!(LOWEST_PRICE_NOTES as readonly string[]).includes(value)) throw new UserError("Pick who sees the lowest earlier price.");
  await db.update(schema.shops).set({ lowestPriceNote: value as LowestPriceNote, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return value as LowestPriceNote;
}

type Shown = { id: string; priceMinor: number; compareAtMinor: number | null };

/**
 * For each option shown at a reduced price (crossed-out price above the price), the lowest price
 * it had in the 30 days before the reduction began: the start of the running sale, or else when
 * its current price was set. Options whose history doesn't cover those 30 days are left out.
 */
export async function lowestPricesBefore(
  db: Db,
  shopId: string,
  product: { id: string; createdAt: Date; variants: Shown[] },
  sale: Pick<SaleInfo, "id" | "startsAt"> | null,
  now = new Date(),
) {
  const result = new Map<string, number>();
  const reduced = product.variants.filter((v) => v.compareAtMinor !== null && v.compareAtMinor > v.priceMinor);
  if (!reduced.length) return result;
  const history = await db.query.variantPrices.findMany({
    where: inArray(schema.variantPrices.variantId, reduced.map((v) => v.id)),
    orderBy: asc(schema.variantPrices.startsAt),
  });
  // Earlier sales count at the price they charged.
  const earliest = Math.min(...history.map((h) => h.startsAt.getTime()), now.getTime());
  const past = await db.query.sales.findMany({
    where: and(
      eq(schema.sales.shopId, shopId),
      lt(schema.sales.startsAt, now),
      or(isNull(schema.sales.endsAt), gt(schema.sales.endsAt, new Date(earliest - LOWEST_PRICE_DAYS * DAY))),
    ),
  });
  const members = await collectionMembership(db, shopId, past.map((s) => s.collectionId).filter((c): c is string => !!c), [product.id]);
  const covering = past.filter(
    (s) => s.id !== sale?.id && (s.scope === "all" || (s.scope === "products" && s.productIds.includes(product.id)) || (s.scope === "collection" && !!members.get(s.collectionId!)?.has(product.id))),
  );

  for (const v of reduced) {
    const prices = history.filter((h) => h.variantId === v.id && h.startsAt <= now);
    if (!prices.length) continue;
    const start = sale ? sale.startsAt : prices.at(-1)!.startsAt;
    const from = new Date(start.getTime() - LOWEST_PRICE_DAYS * DAY);
    // The history has to reach back to the start of the 30 days, unless the product is newer.
    const atFrom = prices.filter((p) => p.startsAt <= from).at(-1);
    if (!atFrom && product.createdAt <= from) continue;
    const inWindow = prices.filter((p) => p.startsAt > from && p.startsAt < start);
    const regular = [...(atFrom ? [atFrom] : []), ...inWindow].map((p) => p.priceMinor);
    if (!regular.length) continue;
    const candidates = [...regular];
    for (const s of covering) {
      const overlaps = s.startsAt < start && (s.endsAt === null || s.endsAt > from);
      if (overlaps) candidates.push(percentOff(Math.min(...regular), s.percentOff));
    }
    result.set(v.id, Math.min(...candidates));
  }
  return result;
}
