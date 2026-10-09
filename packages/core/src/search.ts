// Store search and browsing: what buyers type in the search box, plus sorting and filters on
// search results and collection pages. Small catalogs, so matching runs in memory over the
// store's active products; words can come in any order and match the title, the description
// or an option name, and title matches rank first.
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { convertPrice, noConversion, type DisplayFx } from "./money";
import { listActiveProducts } from "./products";

type ActiveProduct = Awaited<ReturnType<typeof listActiveProducts>>[number];

export const SORTS = {
  relevance: "Best match",
  featured: "Featured",
  best_selling: "Best selling",
  price_asc: "Price, low to high",
  price_desc: "Price, high to low",
  newest: "Newest",
} as const;
export type Sort = keyof typeof SORTS;

export type BrowseOptions = {
  q?: string;
  sort?: string;
  /** Price range in the buyer's currency, in minor units. */
  minMinor?: number | null;
  maxMinor?: number | null;
  inStock?: boolean;
};

const plain = (s: string) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");

/** "Lamps" finds "lamp" and the other way round: a trailing s is optional. */
const words = (q: string) =>
  plain(q)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));

const lowestPrice = (p: ActiveProduct) => Math.min(...p.variants.map((v) => v.priceMinor));
const inStock = (p: ActiveProduct) => p.variants.some((v) => v.stock === null || v.stock > 0);

/** Units sold per product, from paid orders. */
async function unitsSold(db: Db, shopId: string, productIds: string[]) {
  if (!productIds.length) return new Map<string, number>();
  const rows = await db
    .select({ productId: schema.variants.productId, units: sql<number>`sum(${schema.orderLines.quantity})::int` })
    .from(schema.orderLines)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
    .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .where(
      and(
        eq(schema.orders.shopId, shopId),
        inArray(schema.orders.paymentStatus, ["paid", "partially_refunded"]),
        inArray(schema.variants.productId, productIds),
      ),
    )
    .groupBy(schema.variants.productId);
  return new Map(rows.map((r) => [r.productId, Number(r.units)]));
}

/**
 * Filters and sorts a list of active products (all of them for search, a collection's in its
 * order). "featured" keeps the order given; with a query the default is best match.
 */
export async function browseProducts(db: Db, shopId: string, products: ActiveProduct[], options: BrowseOptions, fx: DisplayFx = noConversion("USD")) {
  const terms = words(options.q ?? "");
  const sort: Sort = options.sort && options.sort in SORTS ? (options.sort as Sort) : terms.length ? "relevance" : "featured";
  const price = (p: ActiveProduct) => convertPrice(lowestPrice(p), fx);

  let scored = products
    .filter((p) => p.variants.length)
    .map((p, position) => {
      if (!terms.length) return { p, position, score: 0 };
      const title = plain(p.title);
      const rest = `${plain(p.descriptionHtml)} ${p.variants.filter((v) => v.title !== "Default").map((v) => plain(v.title)).join(" ")}`;
      let score = 0;
      for (const t of terms) {
        if (title.includes(t)) score += title.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(t)) ? 3 : 2;
        else if (rest.includes(t)) score += 1;
        else return null; // every word has to match somewhere
      }
      return { p, position, score };
    })
    .filter((r): r is { p: ActiveProduct; position: number; score: number } => !!r);

  if (options.minMinor != null) scored = scored.filter((r) => price(r.p) >= options.minMinor!);
  if (options.maxMinor != null) scored = scored.filter((r) => price(r.p) <= options.maxMinor!);
  if (options.inStock) scored = scored.filter((r) => inStock(r.p));

  const sold = sort === "best_selling" ? await unitsSold(db, shopId, scored.map((r) => r.p.id)) : null;
  const by: Record<Sort, (a: (typeof scored)[number], b: (typeof scored)[number]) => number> = {
    relevance: (a, b) => b.score - a.score || a.position - b.position,
    featured: (a, b) => a.position - b.position,
    best_selling: (a, b) => (sold!.get(b.p.id) ?? 0) - (sold!.get(a.p.id) ?? 0) || a.position - b.position,
    price_asc: (a, b) => price(a.p) - price(b.p) || a.position - b.position,
    price_desc: (a, b) => price(b.p) - price(a.p) || a.position - b.position,
    newest: (a, b) => b.p.createdAt.getTime() - a.p.createdAt.getTime() || a.position - b.position,
  };
  const sorted = scored.sort(by[sort]).map((r) => r.p);
  return { products: sorted, sort, terms };
}

/** The search page: every active product in the store, filtered and sorted. */
export async function searchProducts(db: Db, shopId: string, options: BrowseOptions, fx?: DisplayFx) {
  return browseProducts(db, shopId, await listActiveProducts(db, shopId), options, fx);
}

/** Products in the grid's compact shape, priced from the cheapest option. */
export const compactProducts = (products: ActiveProduct[]) =>
  products.map((p) => {
    const cheapest = p.variants.reduce((a, b) => (b.priceMinor < a.priceMinor ? b : a), p.variants[0]!);
    return { id: p.id, title: p.title, handle: p.handle, imageUrl: p.imageUrl, priceMinor: cheapest?.priceMinor ?? 0, compareAtMinor: cheapest?.compareAtMinor ?? null };
  });
