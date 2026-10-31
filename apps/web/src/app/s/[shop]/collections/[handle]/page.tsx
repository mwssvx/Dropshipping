import { browseProducts, compactProducts, getCollectionByHandle, gridPage, NotFoundError, productRatings } from "@sf/core";
import { db } from "@/lib/server";
import { buyerFx } from "@/lib/currency";
import { BrowseBar, browseOptions, ShowMore, type BrowseParams } from "@/theme/Browse";
import { ProductGrid } from "@/theme/Sections";
import { addToCartAction } from "../../actions";
import { loadShop, loadTheme, localCollections, localProducts, storeBase, storeT, missing } from "../../data";

async function load(param: string, handle: string, count = true) {
  const shop = await loadShop(param);
  try {
    const found = await getCollectionByHandle(await db(), shop.id, handle);
    // The built-in "all" collection has no id and nothing to translate.
    const c = found.collection;
    const local = c.id ? (await localCollections(param, [{ ...c, id: c.id }]))[0]! : null;
    return { shop, ...found, collection: local ? { ...c, title: local.title, description: local.description } : c };
  } catch (e) {
    if (e instanceof NotFoundError) return missing(param, `/collections/${handle}`, count);
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ shop: string; handle: string }> }) {
  const { shop, handle } = await params;
  const { collection } = await load(shop, handle, false);
  const description = collection.description.replace(/\s+/g, " ").trim().slice(0, 160) || undefined;
  return { title: collection.title, description, openGraph: { title: collection.title, description, images: collection.imageUrl ? [{ url: collection.imageUrl }] : undefined } };
}

export default async function CollectionPage({ params, searchParams }: { params: Promise<{ shop: string; handle: string }>; searchParams: Promise<BrowseParams> }) {
  const { shop: param, handle } = await params;
  const query = await searchParams;
  const { shop, collection, products: all } = await load(param, handle);
  const [base, fx, theme] = await Promise.all([storeBase(param), buyerFx(shop), loadTheme(param)]);
  // The merchant's pick for this collection, until the buyer chooses another order.
  const natural = "sortOrder" in collection ? collection.sortOrder : "featured";
  const { products, sort, facets } = await browseProducts(await db(), shop.id, all, { ...browseOptions(query), sort: query.sort || natural, q: undefined }, fx);
  // Long collections come 24 at a time; only those are translated and drawn.
  const paged = gridPage(products.length, query.page);
  // The grid takes the catalog's compact product shape, with each card's stars.
  const shown = products.slice(0, paged.shown);
  const [local, ratings] = await Promise.all([localProducts(param, compactProducts(shown)), productRatings(await db(), shop.id, shown.map((p) => p.id))]);
  const compact = local.map((p) => ({ ...p, rating: ratings.get(p.id) ?? null }));
  const t = await storeT(param);
  const data = { base, currency: shop.currency, fx, t, badges: shop.productBadges, quickAdd: shop.cardQuickAdd ? addToCartAction.bind(null, param) : undefined, catalog: { products: compact, collections: [] } };
  const filtered = !!(query.min || query.max || query.stock || query.sale || query.opt);
  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-8">
      {theme.settings.collectionBanner && collection.imageUrl ? (
        <header className="sf-collection-banner relative overflow-hidden rounded-lg text-white flex items-end min-h-48 sm:min-h-72">
          <img src={collection.imageUrl} alt="" className="absolute inset-0 size-full object-cover" fetchPriority="high" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/35 to-black/10" aria-hidden />
          <div className="relative p-6 sm:p-10 flex flex-col gap-2">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{collection.title}</h1>
            {collection.description && <p className="text-white/90 max-w-2xl whitespace-pre-line">{collection.description}</p>}
          </div>
        </header>
      ) : (
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">{collection.title}</h1>
          {collection.description && <p className="text-muted max-w-2xl whitespace-pre-line">{collection.description}</p>}
        </header>
      )}
      {all.length > 1 && <BrowseBar action={`${base}/collections/${collection.handle}`} params={{ ...query, q: undefined }} sort={sort} natural={natural} currency={fx.currency} count={products.length} facets={facets} t={t} />}
      {compact.length ? <ProductGrid products={compact} data={data} numbered /> : <p className="hint">{filtered ? t.nothingMatchesFilters : t.nothingYet}</p>}
      <ShowMore action={`${base}/collections/${collection.handle}`} params={{ ...query, q: undefined }} {...paged} t={t} />
    </main>
  );
}
