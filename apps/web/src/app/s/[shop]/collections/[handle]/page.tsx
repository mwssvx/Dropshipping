import { notFound } from "next/navigation";
import { getCollectionByHandle, NotFoundError } from "@sf/core";
import { db } from "@/lib/server";
import { ProductGrid } from "@/theme/Sections";
import { loadShop, storeBase } from "../../data";

async function load(param: string, handle: string) {
  const shop = await loadShop(param);
  try {
    return { shop, ...(await getCollectionByHandle(await db(), shop.id, handle)) };
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ shop: string; handle: string }> }) {
  const { shop, handle } = await params;
  const { collection } = await load(shop, handle);
  const description = collection.description.replace(/\s+/g, " ").trim().slice(0, 160) || undefined;
  return { title: collection.title, description, openGraph: { title: collection.title, description, images: collection.imageUrl ? [{ url: collection.imageUrl }] : undefined } };
}

export default async function CollectionPage({ params }: { params: Promise<{ shop: string; handle: string }> }) {
  const { shop: param, handle } = await params;
  const { shop, collection, products } = await load(param, handle);
  const base = await storeBase(param);
  // The grid takes the catalog's compact product shape.
  const compact = products.map((p) => ({
    id: p.id, title: p.title, handle: p.handle, imageUrl: p.imageUrl,
    priceMinor: p.variants[0]?.priceMinor ?? 0, compareAtMinor: p.variants[0]?.compareAtMinor ?? null,
  }));
  const data = { base, currency: shop.currency, catalog: { products: compact, collections: [] } };
  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{collection.title}</h1>
        {collection.description && <p className="text-muted max-w-2xl whitespace-pre-line">{collection.description}</p>}
      </header>
      {compact.length ? <ProductGrid products={compact} data={data} /> : <p className="hint">Nothing here yet. Check back soon.</p>}
    </main>
  );
}
