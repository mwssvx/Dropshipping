import Link from "next/link";
import { listProducts } from "@sf/core";
import { requireShop } from "@/lib/server";
import { createCollectionAction } from "../../../store-actions";
import { PageHeader } from "../../PageHeader";
import { CollectionForm } from "../CollectionForm";
import { ruleProducts } from "../rule-products";

export const metadata = { title: "Create collection" };

export default async function NewCollectionPage() {
  const { shop, db } = await requireShop("collections");
  const products = await listProducts(db, shop.id);
  return (
    <main className="pb-12">
      <PageHeader title="Create collection" back={<Link href="/admin/collections" className="hint hover:text-ink">← Collections</Link>} />
      <div className="px-4 sm:px-8">
        <CollectionForm action={createCollectionAction} submitLabel="Save collection" products={ruleProducts(products)} currency={shop.currency}
          initial={{ title: "", description: "", imageUrl: "", productIds: [], rules: null, sortOrder: "featured" }} />
      </div>
    </main>
  );
}
