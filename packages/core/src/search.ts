// Store search and browsing: what buyers type in the search box, plus sorting and filters on
// search results and collection pages. Small catalogs, so matching runs in memory over the
// store's active products; words can come in any order and match the title, the description
// or an option name, and title matches rank first.
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { convertPrice, noConversion, type DisplayFx } from "./money";
import { listActiveProducts } from "./products";
import { placeSoldOut, productSoldOut, quickAddVariant, soldOutDisplay } from "./badges";
import { fixedSearch } from "./search-terms";
import { cardSwatches } from "./swatches";
import { secondPhoto } from "./gallery";

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
  /** Only products with a variant on sale (a compare-at price above the price). */
  onSale?: boolean;
  /** Chosen option values, like { Size: ["M", "L"], Color: ["Black"] }. One variant has to match them all. */
  options?: Record<string, string[]>;
};

/** An option shoppers can filter by, with how many products have each value. */
export type Facet = { name: string; values: { value: string; count: number }[] };

const MAX_FACETS = 4;
const MAX_VALUES = 30;

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

/** Search text and words the way product search reads them, for searching other things alike. */
export { plain as plainSearchText, words as searchWords };

type Variant = ActiveProduct["variants"][number];
const lowestPrice = (p: ActiveProduct) => Math.min(...p.variants.map((v) => v.priceMinor));
const variantInStock = (v: Variant) => v.stock === null || v.stock > 0;
const inStock = (p: ActiveProduct) => p.variants.some(variantInStock);
const onSale = (v: Variant) => v.compareAtMinor != null && v.compareAtMinor > v.priceMinor;
/** Option names match whatever the case ("Colour" and "colour" are one filter). */
// "Colour" and "Color" are the same filter.
const key = (name: string) => name.trim().toLowerCase().replace(/^colour$/, "color");

/**
 * The options found on these products, most common first, with each value's product count.
 * Only options with at least two values are worth filtering by.
 */
export function optionFacets(products: ActiveProduct[]): Facet[] {
  const names = new Map<string, { spellings: Map<string, number>; values: Map<string, Set<string>> }>();
  for (const p of products) {
    for (const v of p.variants) {
      for (const [name, value] of Object.entries(v.options ?? {})) {
        if (!name.trim() || !value.trim()) continue;
        const entry = names.get(key(name)) ?? { spellings: new Map(), values: new Map() };
        names.set(key(name), entry);
        entry.spellings.set(name.trim(), (entry.spellings.get(name.trim()) ?? 0) + 1);
        const set = entry.values.get(value.trim()) ?? new Set<string>();
        set.add(p.id);
        entry.values.set(value.trim(), set);
      }
    }
  }
  return [...names.values()]
    .filter((f) => f.values.size >= 2)
    // Shown under the spelling most variants use.
    .map((f) => ({ name: [...f.spellings].sort((a, b) => b[1] - a[1] || Number(/^[A-Z]/.test(b[0])) - Number(/^[A-Z]/.test(a[0])))[0]![0], products: new Set([...f.values.values()].flatMap((s) => [...s])).size, values: [...f.values].map(([value, ids]) => ({ value, count: ids.size })) }))
    .sort((a, b) => b.products - a.products)
    .slice(0, MAX_FACETS)
    .map(({ name, values }) => ({ name, values: values.slice(0, MAX_VALUES) }));
}

/** Whether one variant has every chosen option (any of the chosen values for each). */
function variantMatches(v: Variant, chosen: [string, Set<string>][]) {
  const own = new Map(Object.entries(v.options ?? {}).map(([n, val]) => [key(n), val.trim()]));
  return chosen.every(([name, values]) => values.has(own.get(name) ?? "\u0000"));
}

/** Units sold per product, from paid orders. */
/** Units of each product sold in paid orders. */
export async function unitsSold(db: Db, shopId: string, productIds: string[]) {
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
  // A search the merchant pointed at other words shows those words' results.
  const fixes = options.q?.trim() ? ((await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId), columns: { searchFixes: true } }))?.searchFixes ?? []) : [];
  const showingFor = fixedSearch(fixes, options.q);
  const terms = words(showingFor ?? options.q ?? "");
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

  // Options are offered from what the search matched, before any option is chosen, so picking
  // "Black" doesn't hide the other colours.
  const facets = optionFacets(scored.map((r) => r.p));
  const chosen = Object.entries(options.options ?? {})
    .map(([name, values]) => [key(name), new Set(values.map((v) => v.trim()).filter(Boolean))] as [string, Set<string>])
    .filter(([, values]) => values.size);
  if (chosen.length || options.onSale) {
    // The same variant has to be the right size and colour, in stock when asked, and on sale when asked.
    scored = scored.filter((r) =>
      r.p.variants.some((v) => variantMatches(v, chosen) && (!options.inStock || variantInStock(v)) && (!options.onSale || onSale(v))),
    );
  }
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
  const sorted = placeSoldOut(scored.sort(by[sort]).map((r) => r.p), await soldOutDisplay(db, shopId), (p) => productSoldOut(p));
  return { products: sorted, sort, terms, facets, showingFor };
}

/** The search page: every active product in the store, filtered and sorted. */
export async function searchProducts(db: Db, shopId: string, options: BrowseOptions, fx?: DisplayFx) {
  return browseProducts(db, shopId, await listActiveProducts(db, shopId), options, fx);
}

/** Products in the grid's compact shape, priced from the cheapest option. */
export const GRID_PAGE_SIZE = 24;

/**
 * How much of a long product grid to show: page 1 is the first 24, and each "Show more" adds 24 to
 * the same page, so the shopper keeps their place. Nonsense or out-of-range pages are clamped.
 */
export function gridPage(total: number, raw: string | undefined, size = GRID_PAGE_SIZE) {
  const last = Math.max(1, Math.ceil(total / size));
  const page = Math.min(last, Math.max(1, Math.floor(Number(raw)) || 1));
  const shown = Math.min(total, page * size);
  return { page, shown, total, more: shown < total };
}

export const compactProducts = (products: ActiveProduct[]) =>
  products.map((p) => {
    const cheapest = p.variants.reduce((a, b) => (b.priceMinor < a.priceMinor ? b : a), p.variants[0]!);
    return {
      id: p.id,
      title: p.title,
      handle: p.handle,
      imageUrl: p.imageUrl,
      hoverImageUrl: secondPhoto(p),
      priceMinor: cheapest?.priceMinor ?? 0,
      contents: cheapest?.contents ?? null,
      compareAtMinor: cheapest?.compareAtMinor ?? null,
      badge: p.badge,
      createdAt: p.createdAt,
      soldOut: productSoldOut(p),
      swatches: cardSwatches(p),
      quickAdd: quickAddVariant(p),
    };
  });
