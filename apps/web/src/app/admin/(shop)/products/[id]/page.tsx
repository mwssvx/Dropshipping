import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney, getProduct, getSupplierLink, listOwnSuppliers, listProducts, NotFoundError, supplierLabel, waitingForProduct, MAX_PHOTOS, productPhotos, savedCount, variantPhotoRows, shopLanguages, LANGUAGES } from "@sf/core";
import { requireShop, storeAddress, suppliers } from "@/lib/server";
import { updateProductAction } from "../../../actions";
import { setUpsellAction } from "../../../growth-actions";
import { setProductSupplierAction } from "../../../supplier-actions";
import { PageHeader } from "../../PageHeader";
import { ProductForm } from "../ProductForm";
import { QuantityBreaksForm } from "./QuantityBreaksForm";
import { AddressForm } from "./AddressForm";
import { PhotosPanel } from "./PhotosPanel";
import { VariantPhotosPanel } from "./VariantPhotosPanel";
import { BackupPanel, type BackupView } from "./BackupPanel";
import { StockPanel } from "./StockPanel";
import { WriteListingButton } from "./WriteListingButton";

const toPrice = (m: number | null | undefined) => (m == null ? "" : (m / 100).toFixed(2));

export default async function EditProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; imported?: string; saved?: string; emailed?: string }> }) {
  const { id } = await params;
  const { created, imported, saved, emailed } = await searchParams;
  const sentCount = Number(emailed) || 0;
  const { shop, db } = await requireShop("products");
  const found = await getProduct(db, shop.id, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const link = found.supplierId ? await getSupplierLink(db, shop.id, found.supplierId) : undefined;
  const label = link ? supplierLabel(suppliers(), link) : undefined;
  const product = { ...found, supplier: label ? { label } : null };
  const own = await listOwnSuppliers(db, shop.id);
  const backupLink = found.backup ? await getSupplierLink(db, shop.id, found.backup.supplierId) : undefined;
  const backup: BackupView | null = found.backup
    ? {
        label: supplierLabel(suppliers(), backupLink),
        sourceUrl: found.backup.sourceUrl,
        gone: !!found.backup.gone,
        rows: found.variants.map((v) => {
          const b = found.backup!.variants[v.id];
          return {
            option: v.title,
            cost: b ? formatMoney(b.costMinor, shop.currency) : null,
            mainCost: v.costMinor != null ? formatMoney(v.costMinor, shop.currency) : null,
            stock: !b ? null : b.stock === null ? "in stock" : b.stock === 0 ? "sold out" : `${b.stock} in stock`,
          };
        }),
      }
    : null;
  const waitingBy = await waitingForProduct(db, shop.id, product.id);
  const saves = await savedCount(db, shop.id, product.id);
  const waiting = product.variants.filter((v) => waitingBy.has(v.id)).map((v) => ({ option: v.title, count: waitingBy.get(v.id)! }));
  const others = (await listProducts(db, shop.id)).filter((p) => p.id !== product.id && p.status !== "archived");
  return (
    <main className="pb-12">
      <PageHeader title={product.title} back={<Link href="/admin/products" className="hint hover:text-ink">← Products</Link>}
        actions={product.status === "active" ? <a className="btn btn-secondary" href={`/s/${shop.handle}/products/${product.handle}`} target="_blank">View on store ↗</a> : undefined} />
      <div className="px-4 sm:px-8 flex flex-col gap-4">
        {created && <p role="status" className="banner banner-info">Product added.</p>}
        {saved && (
          <p role="status" className="banner banner-info">
            Saved.{sentCount > 0 && ` ${sentCount === 1 ? "1 buyer who was" : `${sentCount} buyers who were`} waiting got a back-in-stock email.`}
          </p>
        )}
        {imported && (
          <p role="status" className="banner banner-info">
            {product.status === "active"
              ? "Imported and live on your store. Orders for it go to the supplier automatically."
              : "Imported as a draft. Check the description and prices, then set it to Active."}
          </p>
        )}
        {saves > 0 && (
          <p className="banner banner-info">
            {saves === 1 ? "1 buyer saved" : `${saves} buyers saved`} this for later. If you lower the price, signed-in buyers get one email about it.
          </p>
        )}
        <WriteListingButton productId={product.id} live={product.status === "active"} />
        <StockPanel productId={product.id} waiting={waiting} linked={!!product.sourceUrl && !product.giftCard}
          checkedAt={product.stockCheckedAt ? product.stockCheckedAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null} />
        <ProductForm key={product.updatedAt.getTime()} action={updateProductAction.bind(null, product.id)} currency={shop.currency} submitLabel="Save changes"
          initial={{
            title: product.title,
            description: product.descriptionHtml,
            status: product.status,
            variants: product.variants.map((v) => ({
              id: v.id,
              title: v.title,
              options: v.options,
              price: toPrice(v.priceMinor),
              compareAt: toPrice(v.compareAtMinor),
              cost: toPrice(v.costMinor),
              stock: v.stock,
              fromSupplier: !!v.supplierVariantRef,
            })),
            supplier: product.supplier ? { label: product.supplier.label, sourceUrl: product.sourceUrl } : undefined,
            // Supplier options are tied to the supplier's listing, and gift card options are amounts.
            optionsEditable: !product.giftCard && !product.variants.some((v) => v.supplierVariantRef),
          }} />
        <PhotosPanel productId={product.id} title={product.title} photos={productPhotos(product)} max={MAX_PHOTOS} />
        {product.variants.length > 1 && productPhotos(product).length > 1 && !product.giftCard && (
          <VariantPhotosPanel productId={product.id} photos={productPhotos(product)}
            {...variantPhotoRows(product.variants.map((v) => ({ id: v.id, title: v.title, options: v.options ?? {}, imageUrl: v.imageUrl })))} />
        )}
        <AddressForm productId={product.id} handle={product.handle} prefix={(await storeAddress(shop)).replace(/^https?:\/\//, "")} />
        {shopLanguages(shop).length > 0 && (
          <p className="text-sm max-w-3xl">
            <span className="hint">Translations: </span>
            {shopLanguages(shop).map((l, n) => (
              <span key={l}>{n > 0 && " · "}<Link href={`/admin/languages/${l}/product/${product.id}`} className="underline">{LANGUAGES[l].english}</Link></span>
            ))}
          </p>
        )}
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
          {product.sourceUrl && link && link.provider !== "email" && <BackupPanel productId={product.id} mainLabel={label!} backup={backup} />}
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
