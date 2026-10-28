import { browseProducts, compactProducts, getCollectionByHandle, NotFoundError } from "@sf/core";
import { db } from "@/lib/server";
import { buyerFx } from "@/lib/currency";
import { BrowseBar, browseOptions, type BrowseParams } from "@/theme/Browse";
import { ProductGrid } from "@/theme/Sections";
import { addToCartAction } from "../../actions";
import { loadShop, localCollections, localProducts, storeBase, storeT, missing } from "../../data";

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
  const [base, fx] = await Promise.all([storeBase(param), buyerFx(shop)]);
  // The merchant's pick for this collection, until the buyer chooses another order.
  const natural = "sortOrder" in collection ? collection.sortOrder : "featured";
  const { products, sort, facets } = await browseProducts(await db(), shop.id, all, { ...browseOptions(query), sort: query.sort || natural, q: undefined }, fx);
  // The grid takes the catalog's compact product shape.
  const compact = await localProducts(param, compactProducts(products));
  const t = await storeT(param);
  const data = { base, currency: shop.currency, fx, t, badges: shop.productBadges, quickAdd: shop.cardQuickAdd ? addToCartAction.bind(null, param) : undefined, catalog: { products: compact, collections: [] } };
  const filtered = !!(query.min || query.max || query.stock || query.sale || query.opt);
  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{collection.title}</h1>
        {collection.description && <p className="text-muted max-w-2xl whitespace-pre-line">{collection.description}</p>}
      </header>
      {all.length > 1 && <BrowseBar action={`${base}/collections/${collection.handle}`} params={{ ...query, q: undefined }} sort={sort} natural={natural} currency={fx.currency} count={compact.length} facets={facets} t={t} />}
      {compact.length ? <ProductGrid products={compact} data={data} /> : <p className="hint">{filtered ? t.nothingMatchesFilters : t.nothingYet}</p>}
    </main>
  );
}
