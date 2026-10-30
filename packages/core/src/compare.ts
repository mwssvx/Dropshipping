// Compare: a shopper picks up to four products and sees them side by side (price, rating, options,
// whether they're in stock, and the merchant's own details table, "Material", "Size", lined up by
// label). The picks live in a cookie on the shopper's device, as product ids only.
import { and, asc, avg, count, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { optionDefsOf } from "./products";

export const COMPARE_MAX = 4;

/** The product ids in the shopper's compare list, as found in their cookie. */
export function compareIdsFrom(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x));
  return [...new Set(ids)].slice(0, COMPARE_MAX);
}

/** Adds or takes off a product. Adding to a full list changes nothing and says so. */
export function toggleCompareId(ids: string[], productId: string, on: boolean): { ids: string[]; full: boolean } {
  const now = compareIdsFrom(ids);
  if (!on) return { ids: now.filter((id) => id !== productId), full: false };
  if (now.includes(productId)) return { ids: now, full: false };
  if (now.length >= COMPARE_MAX) return { ids: now, full: true };
  return { ids: [...now, productId], full: false };
}

/**
 * The products to compare, in the order they were added, with their variants, rating and options.
 * Drafts, archived products and gift cards drop out. `labels` are the details rows: every label any
 * of them uses, in the order first seen, matched without regard to case.
 */
export async function compareProducts(db: Db, shopId: string, ids: string[]) {
  const wanted = compareIdsFrom(ids);
  if (!wanted.length) return { products: [], labels: [] as string[] };
  const found = await db.query.products.findMany({
    where: and(eq(schema.products.shopId, shopId), inArray(schema.products.id, wanted), eq(schema.products.status, "active"), eq(schema.products.giftCard, false)),
  });
  const variants = found.length ? await db.query.variants.findMany({ where: inArray(schema.variants.productId, found.map((p) => p.id)), orderBy: asc(schema.variants.position) }) : [];
  const ratings = found.length
    ? await db
        .select({ productId: schema.reviews.productId, n: count(), avg: avg(schema.reviews.rating) })
        .from(schema.reviews)
        .where(and(inArray(schema.reviews.productId, found.map((p) => p.id)), eq(schema.reviews.status, "published")))
        .groupBy(schema.reviews.productId)
    : [];
  const products = wanted.flatMap((id) => {
    const row = found.find((x) => x.id === id);
    const mine = variants.filter((v) => v.productId === id);
    if (!row || !mine.length) return [];
    const p = { ...row, variants: mine };
    const r = ratings.find((x) => x.productId === id);
    const n = Number(r?.n ?? 0);
    return [{
      ...p,
      rating: { count: n, average: n ? Math.round(Number(r!.avg) * 10) / 10 : null },
      options: optionDefsOf(p.variants),
      soldOut: p.variants.every((v) => v.stock !== null && v.stock <= 0),
    }];
  });
  const labels: string[] = [];
  for (const p of products) for (const d of p.details) if (!labels.some((l) => l.toLowerCase() === d.label.toLowerCase())) labels.push(d.label);
  return { products, labels };
}

/** A product's value for a details row, or null when it doesn't say. */
export const compareDetail = (details: { label: string; value: string }[], label: string) => details.find((d) => d.label.toLowerCase() === label.toLowerCase())?.value ?? null;
