import Link from "next/link";
import { Track } from "@/components/Track";
import { describeBreak, getActiveProductByHandle, NotFoundError, percentOff, productPhotos, productReviews, upsellsFor, wholesaleTermsFor } from "@sf/core";
import { ProductGallery } from "@/components/ProductGallery";
import { currentBuyer } from "@/lib/buyer";
import { db } from "@/lib/server";
import { buyerFx } from "@/lib/currency";
import { SubmitButton } from "@/components/SubmitButton";
import { addToCartAction, stockAlertAction } from "../../actions";
import { loadShop, storeBase, missing } from "../../data";
import { Price } from "@/components/Price";

async function load(shopHandle: string, handle: string, count = true) {
  const shop = await loadShop(shopHandle);
  try {
    return { shop, product: await getActiveProductByHandle(await db(), shop.id, handle) };
  } catch (e) {
    if (e instanceof NotFoundError) return missing(shopHandle, `/products/${handle}`, count);
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ shop: string; handle: string }> }) {
  const { shop, handle } = await params;
  const { product } = await load(shop, handle, false);
  const description = summary(product.descriptionHtml) || undefined;
  const photos = productPhotos(product);
  const images = photos.length ? photos.map((url) => ({ url })) : undefined;
  return { title: product.title, description, openGraph: { title: product.title, description, images, type: "website" } };
}

function summary(text: string) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 157).trimEnd()}...` : flat;
}

/** Product data for search engines (schema.org), so results can show price and stock. */
function productJsonLd(product: Awaited<ReturnType<typeof load>>["product"], currency: string, rating: { count: number; average: number | null }) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: summary(product.descriptionHtml) || undefined,
    image: productPhotos(product).length ? productPhotos(product) : undefined,
    offers: product.variants.map((x) => ({
      "@type": "Offer",
      name: x.title,
      price: (x.priceMinor / 100).toFixed(2),
      priceCurrency: currency,
      availability: `https://schema.org/${x.stock === null || x.stock > 0 ? "InStock" : "OutOfStock"}`,
    })),
    ...(rating.count && rating.average !== null ? { aggregateRating: { "@type": "AggregateRating", ratingValue: rating.average, reviewCount: rating.count } } : {}),
  };
}

const ALERT_MESSAGES: Record<string, { text: string; ok: boolean }> = {
  sent: { text: "Done. We'll email you once when it's back.", ok: true },
  back: { text: "Good news: it's in stock now.", ok: true },
  many: { text: "You're already waiting on lots of items here. We'll email you as they come back.", ok: false },
  invalid: { text: "Enter your email address and pick an option.", ok: false },
};

export default async function ProductPage({ params, searchParams }: { params: Promise<{ shop: string; handle: string }>; searchParams: Promise<{ alert?: string }> }) {
  const { shop: shopHandle, handle } = await params;
  const alert = ALERT_MESSAGES[(await searchParams).alert ?? ""];
  const { shop, product } = await load(shopHandle, handle);
  const buyable = product.variants.filter((x) => x.stock === null || x.stock > 0);
  const v = buyable[0] ?? product.variants[0];
  const many = product.variants.length > 1;
  const [reviews, upsells, base, fx] = await Promise.all([productReviews(await db(), product.id), upsellsFor(await db(), shop.id, [product.id]), storeBase(shopHandle), buyerFx(shop)]);
  const buyer = await currentBuyer(shop.id);
  const wholesale = await wholesaleTermsFor(await db(), shop, buyer?.email);
  const soldOut = product.variants.filter((x) => x.stock !== null && x.stock <= 0);
  const tiers = wholesale ? [] : product.quantityBreaks;
  const jsonLd = JSON.stringify(productJsonLd(product, shop.currency, reviews)).replace(/</g, "\\u003c");
  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 grid gap-10 md:grid-cols-2">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <ProductGallery title={product.title} photos={productPhotos(product)} />
      <div className="flex flex-col gap-5">
        <Track shopId={shop.id} kind="product_view" productId={product.id} />
        <h1 className="text-3xl font-bold tracking-tight">{product.title}</h1>
        {reviews.count > 0 && (
          <a href="#reviews" className="text-sm flex items-center gap-2">
            <Stars value={reviews.average ?? 0} />
            <span className="hint">{reviews.average} · {reviews.count} {reviews.count === 1 ? "review" : "reviews"}</span>
          </a>
        )}
        {v && <div className="text-xl"><Price minor={v.priceMinor} compareAt={v.compareAtMinor} currency={shop.currency} fx={fx} /></div>}
        {v && wholesale && (
          <p className="banner banner-info" role="status">
            Your wholesale price: <strong className="num"><Price minor={percentOff(v.priceMinor, wholesale.percentOff)} currency={shop.currency} fx={fx} /></strong> ({wholesale.percentOff}% off)
          </p>
        )}
        {v && tiers.length > 0 && (
          <section aria-labelledby="bulk" className="card p-4 flex flex-col gap-2">
            <h2 id="bulk" className="font-semibold">Buy more, save more</h2>
            <ul className="text-sm flex flex-col gap-1">
              {tiers.map((t) => (
                <li key={t.minQty} className="flex justify-between gap-3">
                  <span>{describeBreak(t)}</span>
                  <span className="num"><Price minor={percentOff(v.priceMinor, t.percentOff)} currency={shop.currency} fx={fx} /> each</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {v && buyable.length > 0 && (
          <form action={addToCartAction.bind(null, shopHandle)} className="flex flex-col gap-4">
            {many ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="label mb-2">Option</legend>
                <div className="flex flex-wrap gap-2">
                  {product.variants.map((x) => {
                    const out = x.stock !== null && x.stock <= 0;
                    return (
                      <label key={x.id} className={`chip ${out ? "opacity-50 line-through" : ""}`}>
                        <input type="radio" name="variantId" value={x.id} defaultChecked={x.id === v.id} disabled={out} className="sr-only peer" />
                        <span>{x.title}</span>
                        <span className="hint num"><Price minor={x.priceMinor} currency={shop.currency} fx={fx} /></span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ) : (
              <input type="hidden" name="variantId" value={v.id} />
            )}
            {tiers.length > 0 || wholesale ? (
              <div className="field w-28">
                <label className="label" htmlFor="quantity">Quantity</label>
                <input className="input num" id="quantity" name="quantity" type="number" min={1} max={99} defaultValue={1} />
              </div>
            ) : (
              <input type="hidden" name="quantity" value="1" />
            )}
            <SubmitButton className="btn btn-primary btn-lg" pendingText="Adding…">Add to cart</SubmitButton>
          </form>
        )}
        {v && buyable.length === 0 && <p className="banner banner-info">Sold out for now.</p>}
        {(soldOut.length > 0 || alert) && (
          <form id="stock-alert" action={stockAlertAction.bind(null, shopHandle, product.handle)} className="card p-4 flex flex-col gap-3" aria-labelledby="stock-alert-h">
            <h2 id="stock-alert-h" className="font-semibold">{buyable.length === 0 ? "Email me when it's back" : "Option sold out? Email me when it's back"}</h2>
            {alert && <p role="status" className={`banner ${alert.ok ? "banner-success" : "banner-critical"}`}>{alert.text}</p>}
            {soldOut.length > 0 && (
              <>
                {soldOut.length === 1 && !many ? (
                  <input type="hidden" name="variantId" value={soldOut[0]!.id} />
                ) : (
                  <div className="field">
                    <label className="label" htmlFor="alert-variant">Option</label>
                    <select className="input" id="alert-variant" name="variantId">
                      {soldOut.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                    </select>
                  </div>
                )}
                <div className="flex flex-wrap gap-2 items-end">
                  <div className="field flex-1 min-w-48">
                    <label className="label" htmlFor="alert-email">Email</label>
                    <input className="input" id="alert-email" name="email" type="email" required autoComplete="email" defaultValue={buyer?.email ?? ""} placeholder="you@example.com" />
                  </div>
                  <SubmitButton className="btn btn-secondary">Notify me</SubmitButton>
                </div>
                <p className="hint text-sm">One email when it&apos;s back, nothing else. We don&apos;t add you to any list.</p>
              </>
            )}
          </form>
        )}
        {v?.shipDaysMin != null && v.shipDaysMax != null && (
          <p className="text-sm">Arrives in {v.shipDaysMin}–{v.shipDaysMax} days</p>
        )}
        {product.descriptionHtml && <div className="text-muted whitespace-pre-line leading-relaxed">{product.descriptionHtml}</div>}
        <ul className="hint flex flex-col gap-1 border-t border-border pt-4">
          <li>Secure checkout. Card details never touch this store.</li>
          <li>Questions about your order? Reply to your confirmation email.</li>
        </ul>
        {upsells.length > 0 && (
          <section className="flex flex-col gap-3 border-t border-border pt-4" aria-labelledby="goes-well">
            <h2 id="goes-well" className="font-semibold">Goes well with</h2>
            {upsells.map((u) => (
              <Link key={u.id} href={`${base}/products/${u.handle}`} className="flex items-center gap-3 hover:underline">
                <span className="size-12 rounded-md bg-sunken overflow-hidden shrink-0">{u.imageUrl && <img src={u.imageUrl} alt="" className="size-full object-cover" />}</span>
                <span className="flex-1">{u.title}</span>
                <span className="num"><Price minor={u.priceMinor} currency={shop.currency} fx={fx} /></span>
              </Link>
            ))}
          </section>
        )}
      </div>
      <section id="reviews" className="md:col-span-2 flex flex-col gap-4 border-t border-border pt-8" aria-labelledby="reviews-heading">
        <h2 id="reviews-heading" className="text-xl font-semibold">Reviews</h2>
        {reviews.count === 0 ? (
          <p className="hint">No reviews yet. Buyers can leave one from their order page once it has shipped.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {reviews.reviews.map((r) => (
              <li key={r.id} className="card p-4 flex flex-col gap-2">
                <div className="flex items-center gap-2"><Stars value={r.rating} /><span className="font-medium text-sm">{r.name}</span></div>
                <p className="text-sm whitespace-pre-line">{r.body}</p>
                {r.reply && <p className="text-sm hint border-l-2 border-border pl-3"><span className="font-medium">{shop.name}: </span>{r.reply}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Stars({ value }: { value: number }) {
  const full = Math.round(value);
  return (
    <span className="text-warning tracking-tight" role="img" aria-label={`${value} out of 5 stars`}>
      {"★".repeat(full)}
      <span className="text-border">{"★".repeat(5 - full)}</span>
    </span>
  );
}
