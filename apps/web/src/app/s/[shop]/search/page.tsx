import Link from "next/link";
import { after } from "next/server";
import { compactProducts, gridPage, recordSearch, searchProducts } from "@sf/core";
import { db } from "@/lib/server";
import { buyerFx } from "@/lib/currency";
import { BrowseBar, browseOptions, ShowMore, type BrowseParams } from "@/theme/Browse";
import { ProductGrid } from "@/theme/Sections";
import { loadShop, localProducts, storeBase, storeT } from "../data";
import { addToCartAction } from "../actions";

export async function generateMetadata({ searchParams }: { searchParams: Promise<BrowseParams> }) {
  const { q } = await searchParams;
  // Result pages are endless variations of the catalog: keep them out of search engines.
  return { title: q?.trim() ? `Search: ${q.trim().slice(0, 60)}` : "Search", robots: { index: false } };
}

export default async function SearchPage({ params, searchParams }: { params: Promise<{ shop: string }>; searchParams: Promise<BrowseParams> }) {
  const { shop: param } = await params;
  const query = await searchParams;
  const shop = await loadShop(param);
  const [base, fx] = await Promise.all([storeBase(param), buyerFx(shop)]);
  const { products, sort, facets, showingFor } = await searchProducts(await db(), shop.id, browseOptions(query), fx);
  const paged = gridPage(products.length, query.page);
  const compact = await localProducts(param, compactProducts(products.slice(0, paged.shown)));
  const t = await storeT(param);
  const q = query.q?.trim();
  // A plain search counts toward the store's search report; re-sorting or filtering it doesn't.
  if (q && Object.entries(query).every(([k, v]) => k === "q" || v === undefined || v === "")) {
    after(async () => {
      await recordSearch(await db(), shop.id, q, products.length).catch(() => {});
    });
  }
  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-8">
      <h1 className="text-3xl font-bold tracking-tight">{q ? t.resultsFor(q) : t.search}</h1>
      {showingFor && <p className="hint" role="status">{t.showingFor(showingFor)}</p>}
      <BrowseBar action={`${base}/search`} params={query} sort={sort} currency={fx.currency} search count={products.length} facets={facets} t={t} />
      {compact.length ? (
        <ProductGrid products={compact} data={{ base, currency: shop.currency, fx, t, badges: shop.productBadges, quickAdd: shop.cardQuickAdd ? addToCartAction.bind(null, param) : undefined, catalog: { products: compact, collections: [] } }} numbered />
      ) : (
        <p className="hint">
          {t.nothingMatches(q ?? null)} {t.tryFewer} <Link href={`${base}/collections/all`} className="underline">{t.seeEverything}</Link>.
        </p>
      )}
      <ShowMore action={`${base}/search`} params={query} {...paged} t={t} />
    </main>
  );
}
