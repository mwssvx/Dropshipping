import Link from "next/link";
import { notFound } from "next/navigation";
import { getCollection, listProducts, NotFoundError } from "@sf/core";
import { requireShop, storeAddress } from "@/lib/server";
import { deleteCollectionAction, updateCollectionAction } from "../../../store-actions";
import { PageHeader } from "../../PageHeader";
import { CollectionForm } from "../CollectionForm";

export const metadata = { title: "Collection" };

export default async function CollectionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const { shop, db } = await requireShop();
  const collection = await getCollection(db, shop.id, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [products, address] = await Promise.all([listProducts(db, shop.id), storeAddress(shop)]);
  return (
    <main className="pb-12">
      <PageHeader title={collection.title} back={<Link href="/admin/collections" className="hint hover:text-ink">← Collections</Link>}
        actions={<a href={`${address}/collections/${collection.handle}`} target="_blank" className="btn btn-secondary">View ↗</a>} />
      <div className="px-4 sm:px-8 flex flex-col gap-6">
        <CollectionForm action={updateCollectionAction.bind(null, collection.id)} submitLabel="Save" products={products}
          saved={(await searchParams).saved === "1"}
          initial={{ title: collection.title, description: collection.description, imageUrl: collection.imageUrl ?? "", productIds: collection.productIds }} />
        <form action={deleteCollectionAction.bind(null, collection.id)}>
          <button className="text-sm text-critical hover:underline">Delete this collection</button>
          <p className="hint">Products stay in your store. Only the grouping is removed.</p>
        </form>
      </div>
    </main>
  );
}
