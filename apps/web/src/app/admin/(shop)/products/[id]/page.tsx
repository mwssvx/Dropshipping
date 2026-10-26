import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney, getProduct, getSupplierLink, listOwnSuppliers, listProducts, NotFoundError, supplierLabel, waitingForProduct, MAX_PHOTOS, productPhotos, savedCount, variantPhotoRows, shopLanguages, LANGUAGES, formatShipsBy, openPreorder, preordersSold, PREORDER_MAX_DAYS, searchSnippet, SEO_TITLE_MAX, SEO_DESCRIPTION_MAX, describePurchaseLimit, BADGE_MAX_LENGTH, PHOTO_TEXT_MAX, publishDueProducts, detailsText, MAX_DETAILS } from "@sf/core";
import { requireShop, storeAddress, suppliers } from "@/lib/server";
import { duplicateProductAction, updateProductAction } from "../../../actions";
import { setUpsellAction } from "../../../growth-actions";
import { setProductSupplierAction } from "../../../supplier-actions";
import { PageHeader } from "../../PageHeader";
import { ProductForm } from "../ProductForm";
import { QuantityBreaksForm } from "./QuantityBreaksForm";
import { PersonalizationForm } from "./PersonalizationForm";
import { PreorderForm } from "./PreorderForm";
import { PurchaseLimitForm } from "./PurchaseLimitForm";
import { VideoForm } from "./VideoForm";
import { DetailsForm } from "./DetailsForm";
import { BadgeForm } from "./BadgeForm";
import { PublishLaterPanel } from "./PublishLaterPanel";
import { SeoForm } from "./SeoForm";
import { AddressForm } from "./AddressForm";
import { PhotosPanel } from "./PhotosPanel";
import { VariantPhotosPanel } from "./VariantPhotosPanel";
import { BackupPanel, type BackupView } from "./BackupPanel";
import { StockPanel } from "./StockPanel";
import { WriteListingButton } from "./WriteListingButton";

const dateIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const toPrice = (m: number | null | undefined) => (m == null ? "" : (m / 100).toFixed(2));

export default async function EditProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; imported?: string; saved?: string; emailed?: string; duplicated?: string }> }) {
  const { id } = await params;
  const { created, imported, saved, emailed, duplicated } = await searchParams;
  const sentCount = Number(emailed) || 0;
  const { shop, db } = await requireShop("products");
  await publishDueProducts(db, shop.id);
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
  const preSold = product.preorder ? await preordersSold(db, product.id) : 0;
  const saves = await savedCount(db, shop.id, product.id);
  const waiting = product.variants.filter((v) => waitingBy.has(v.id)).map((v) => ({ option: v.title, count: waitingBy.get(v.id)! }));
  const others = (await listProducts(db, shop.id)).filter((p) => p.id !== product.id && p.status !== "archived");
  return (
    <main className="pb-12">
      <PageHeader title={product.title} back={<Link href="/admin/products" className="hint hover:text-ink">← Products</Link>}
        actions={
          <>
            <form action={duplicateProductAction.bind(null, product.id)}>
              <button className="btn btn-secondary">Duplicate</button>
            </form>
            {product.status === "active" && <a className="btn btn-secondary" href={`/s/${shop.handle}/products/${product.handle}`} target="_blank">View on store ↗</a>}
          </>
        } />
      <div className="px-4 sm:px-8 flex flex-col gap-4">
        {created && <p role="status" className="banner banner-info">Product added.</p>}
        {duplicated && (
          <p role="status" className="banner banner-info">
            This is a copy, saved as a draft so buyers can't see it yet. Change what's different, then put it on sale. Reviews and questions stay with the original.
            {!product.supplierId && product.variants.some((v) => v.stock !== null) && " Its stock starts at 0, so enter how many you have."}
          </p>
        )}
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
        {product.status === "draft" && (
          <section className="card p-5 flex flex-col gap-3 max-w-3xl" aria-labelledby="publish-later-heading">
            <div>
              <h2 id="publish-later-heading" className="font-semibold">Put on sale later</h2>
              <p className="hint">For a launch or a drop you announce ahead: it goes on sale by itself at this time, with the first visitor after it.</p>
            </div>
            <PublishLaterPanel productId={product.id} title={product.title} publishAt={product.publishAt?.toISOString() ?? null} />
          </section>
        )}
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
        <PhotosPanel productId={product.id} title={product.title} photos={productPhotos(product)} texts={product.imageAlts} max={MAX_PHOTOS} textMax={PHOTO_TEXT_MAX} />
        {!product.giftCard && (
          <section className="card p-5 flex flex-col gap-3 max-w-3xl" aria-labelledby="video-heading">
            <div>
              <h2 id="video-heading" className="font-semibold">Video</h2>
              <p className="hint">Paste a YouTube or Vimeo link, or the address of a video file (many suppliers have one). It shows after the photos, and the player only loads when a buyer presses play.</p>
            </div>
            <VideoForm productId={product.id} url={product.videoUrl ?? ""} />
          </section>
        )}
        {!product.giftCard && (
          <section className="card p-5 flex flex-col gap-3 max-w-3xl" aria-labelledby="details-heading">
            <div>
              <h2 id="details-heading" className="font-semibold">Details</h2>
              <p className="hint">Short facts buyers look for, like material, size, weight or what&apos;s in the box. They show as a table under the description, and search engines read them too.</p>
            </div>
            <DetailsForm productId={product.id} text={detailsText(product.details)} max={MAX_DETAILS} />
          </section>
        )}
        <section className="card p-5 flex flex-col gap-3 max-w-3xl" aria-labelledby="badge-heading">
          <div>
            <h2 id="badge-heading" className="font-semibold">Badge</h2>
            <p className="hint">A short label on this product&apos;s card and page, like “Bestseller” or “Limited edition”. Up to {BADGE_MAX_LENGTH} characters.</p>
          </div>
          <BadgeForm productId={product.id} badge={product.badge ?? ""} max={BADGE_MAX_LENGTH} />
        </section>
        {product.variants.length > 1 && productPhotos(product).length > 1 && !product.giftCard && (
          <VariantPhotosPanel productId={product.id} photos={productPhotos(product)}
            {...variantPhotoRows(product.variants.map((v) => ({ id: v.id, title: v.title, options: v.options ?? {}, imageUrl: v.imageUrl })))} />
        )}
        <AddressForm productId={product.id} handle={product.handle} prefix={(await storeAddress(shop)).replace(/^https?:\/\//, "")} />
        {!product.giftCard && (
          <section className="card p-5 flex flex-col gap-3 max-w-3xl" aria-labelledby="seo-heading">
            <div>
              <h2 id="seo-heading" className="font-semibold">Search engine listing</h2>
              <p className="hint">How this product shows in Google and other search results. Write it for someone searching: what it is, and why to click.</p>
            </div>
            <SeoForm productId={product.id} title={product.seoTitle ?? ""} description={product.seoDescription ?? ""}
              fallback={{ title: product.title, description: searchSnippet(product.descriptionHtml) }}
              url={`${(await storeAddress(shop)).replace(/^https?:\/\//, "")}/products/${product.handle}`}
              max={{ title: SEO_TITLE_MAX, description: SEO_DESCRIPTION_MAX }} />
          </section>
        )}
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
        {!product.giftCard && (
          <section className="card p-5 flex flex-col gap-3 max-w-3xl" aria-labelledby="personalize-heading">
            <div>
              <h2 id="personalize-heading" className="font-semibold">Personalisation</h2>
              <p className="hint">
                Ask buyers for text before they add this to their cart, like a name to engrave or a message to print. It shows on the order and in
                the receipt, and goes to your supplier with the item. Check that your supplier offers personalisation before turning it on.
              </p>
            </div>
            <PersonalizationForm productId={product.id} fields={product.personalization} />
          </section>
        )}
        {!product.giftCard && (
          <section className="card p-5 flex flex-col gap-3 max-w-3xl" aria-labelledby="preorder-heading">
            <div>
              <h2 id="preorder-heading" className="font-semibold">Pre-orders</h2>
              <p className="hint">
                Keep selling options that are sold out at your supplier, with a date you promise to ship by. Those orders wait and go to your
                supplier as soon as the stock check sees them back. If the date passes first, we email you so you can tell the buyer.
              </p>
            </div>
            {product.preorder && (
              <p className="text-sm" role="note">
                {preSold === 1 ? "1 pre-order" : `${preSold} pre-orders`} so far
                {product.preorder.limit != null ? ` of ${product.preorder.limit}` : ""}.{" "}
                {openPreorder(product) ? `Ships by ${formatShipsBy(product.preorder.shipsBy)}.` : `The ship-by date (${formatShipsBy(product.preorder.shipsBy)}) has passed, so sold-out options can't be bought. Pick a new date to keep taking pre-orders.`}
              </p>
            )}
            <PreorderForm productId={product.id} preorder={product.preorder} min={dateIn(1)} max={dateIn(PREORDER_MAX_DAYS - 1)} />
          </section>
        )}
        {!product.giftCard && (
          <section className="card p-5 flex flex-col gap-3 max-w-3xl" aria-labelledby="limits-heading">
            <div>
              <h2 id="limits-heading" className="font-semibold">Purchase limits</h2>
              <p className="hint">
                Set how many a buyer can order. Use a most per customer for limited drops so one buyer can't take them all, or a least per
                order for cheap items that only pay off in sets. All options of this product count together. Leave a box empty for no limit.
              </p>
            </div>
            {product.purchaseLimit && <p className="text-sm" role="note">Buyers can order {describePurchaseLimit(product.purchaseLimit)}.</p>}
            <PurchaseLimitForm productId={product.id} limit={product.purchaseLimit} />
          </section>
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
