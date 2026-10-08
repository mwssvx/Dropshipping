import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct, NotFoundError } from "@sf/core";
import { requireShop } from "@/lib/server";
import { updateProductAction } from "../../../actions";
import { PageHeader } from "../../PageHeader";
import { ProductForm } from "../ProductForm";

const toPrice = (m: number | null | undefined) => (m == null ? "" : (m / 100).toFixed(2));

export default async function EditProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params;
  const { created } = await searchParams;
  const { shop, db } = await requireShop();
  const product = await getProduct(db, shop.id, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const v = product.variants[0];
  return (
    <main className="pb-12">
      <PageHeader title={product.title} back={<Link href="/admin/products" className="hint hover:text-ink">← Products</Link>}
        actions={product.status === "active" ? <a className="btn btn-secondary" href={`/s/${shop.handle}/products/${product.handle}`} target="_blank">View on store ↗</a> : undefined} />
      <div className="px-4 sm:px-8 flex flex-col gap-4">
        {created && <p role="status" className="banner banner-info">Product added.</p>}
        <ProductForm action={updateProductAction.bind(null, product.id)} currency={shop.currency} submitLabel="Save changes"
          initial={{
            title: product.title,
            description: product.descriptionHtml,
            imageUrl: product.imageUrl ?? "",
            status: product.status,
            price: toPrice(v?.priceMinor),
            compareAt: toPrice(v?.compareAtMinor),
            cost: toPrice(v?.costMinor),
          }} />
      </div>
    </main>
  );
}
