import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct, getSupplierLink, listOwnSuppliers, listProducts, NotFoundError, supplierLabel } from "@sf/core";
import { requireShop, suppliers } from "@/lib/server";
import { updateProductAction } from "../../../actions";
import { setUpsellAction } from "../../../growth-actions";
import { setProductSupplierAction } from "../../../supplier-actions";
import { PageHeader } from "../../PageHeader";
import { ProductForm } from "../ProductForm";
import { QuantityBreaksForm } from "./QuantityBreaksForm";
import { WriteListingButton } from "./WriteListingButton";

const toPrice = (m: number | null | undefined) => (m == null ? "" : (m / 100).toFixed(2));

export default async function EditProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; imported?: string }> }) {
  const { id } = await params;
  const { created, imported } = await searchParams;
  const { shop, db } = await requireShop("products");
  const found = await getProduct(db, shop.id, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const link = found.supplierId ? await getSupplierLink(db, shop.id, found.supplierId) : undefined;
  const label = link ? supplierLabel(suppliers(), link) : undefined;
  const product = { ...found, supplier: label ? { label } : null };
  const own = await listOwnSuppliers(db, shop.id);
  const others = (await listProducts(db, shop.id)).filter((p) => p.id !== product.id && p.status !== "archived");
  return (
    <main className="pb-12">
      <PageHeader title={product.title} back={<Link href="/admin/products" className="hint hover:text-ink">← Products</Link>}
        actions={product.status === "active" ? <a className="btn btn-secondary" href={`/s/${shop.handle}/products/${product.handle}`} target="_blank">View on store ↗</a> : undefined} />
      <div className="px-4 sm:px-8 flex flex-col gap-4">
        {created && <p role="status" className="banner banner-info">Product added.</p>}
        {imported && (
          <p role="status" className="banner banner-info">
            {product.status === "active"
              ? "Imported and live on your store. Orders for it go to the supplier automatically."
              : "Imported as a draft. Check the description and prices, then set it to Active."}
          </p>
        )}
        <WriteListingButton productId={product.id} live={product.status === "active"} />
        <ProductForm key={product.updatedAt.getTime()} action={updateProductAction.bind(null, product.id)} currency={shop.currency} submitLabel="Save changes"
          initial={{
            title: product.title,
            description: product.descriptionHtml,
            imageUrl: product.imageUrl ?? "",
            status: product.status,
            variants: product.variants.map((v) => ({
              title: v.title,
              price: toPrice(v.priceMinor),
              compareAt: toPrice(v.compareAtMinor),
              cost: toPrice(v.costMinor),
              stock: v.supplierVariantRef ? v.stock : undefined,
            })),
            supplier: product.supplier ? { label: product.supplier.label, sourceUrl: product.sourceUrl } : undefined,
          }} />
        {product.giftCard ? (
          <p className="banner banner-info max-w-3xl">
            This is your gift card. Each option&apos;s price is what the card is worth, and codes are emailed to the buyer when they pay.
            See and manage them in <Link href="/admin/gift-cards" className="underline">Gift cards</Link>.
          </p>
        ) : (
          <>
          <section className="card p-5 flex flex-col gap-3 max-w-3xl" aria-labelledby="sent-by-heading">
            <div>
              <h2 id="sent-by-heading" className="font-semibold">Who sends it</h2>
              <p className="hint">
                {link && link.provider !== "email"
                  ? `Orders go to ${label} automatically. Pick one of your own suppliers to send it instead; that stops ${label} orders for this product.`
                  : own.length
                    ? "Paid orders for this product are emailed to the supplier you pick, with a link where they add tracking."
                    : <>Add your own suppliers in <Link href="/admin/suppliers" className="underline hover:text-ink">Suppliers</Link> to have them send this product.</>}
              </p>
            </div>
            {own.length > 0 && (
              <form action={setProductSupplierAction.bind(null, product.id)} className="flex flex-wrap gap-2 items-end">
                <div className="field flex-1 min-w-56">
                  <label className="label" htmlFor="supplierId">Sent by</label>
                  <select className="input" id="supplierId" name="supplierId" defaultValue={link?.provider === "email" ? link.id : link ? "api" : ""} key={product.supplierId ?? "none"}>
                    {link && link.provider !== "email" && <option value="api">{label}</option>}
                    <option value="">Me (I add tracking myself)</option>
                    {own.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <button className="btn btn-secondary">Save</button>
              </form>
            )}
          </section>
          <section className="card p-5 flex flex-col gap-3 max-w-3xl" aria-labelledby="breaks-heading">
            <div>
              <h2 id="breaks-heading" className="font-semibold">Quantity discounts</h2>
              <p className="hint">Buyers who take more of this product pay less for each one. Different options count together. Wholesale buyers get your wholesale price instead.</p>
            </div>
            <QuantityBreaksForm productId={product.id} tiers={product.quantityBreaks} />
          </section>
          </>
        )}
        <section className="card p-5 flex flex-col gap-3 max-w-3xl" aria-labelledby="upsell-heading">
          <div>
            <h2 id="upsell-heading" className="font-semibold">Goes well with</h2>
            <p className="hint">Suggested on this product's page and in the cart. Only shown while it's active and in stock.</p>
          </div>
          <form action={setUpsellAction.bind(null, product.id)} className="flex flex-wrap gap-2 items-end">
            <div className="field flex-1 min-w-56">
              <label className="label" htmlFor="upsellProductId">Suggest</label>
              <select className="input" id="upsellProductId" name="upsellProductId" defaultValue={product.upsellProductId ?? ""} key={product.upsellProductId ?? "none"}>
                <option value="">Nothing</option>
                {others.map((p) => <option key={p.id} value={p.id}>{p.title}{p.status === "draft" ? " (draft)" : ""}</option>)}
              </select>
            </div>
            <button className="btn btn-secondary">Save suggestion</button>
          </form>
        </section>
      </div>
    </main>
  );
}
