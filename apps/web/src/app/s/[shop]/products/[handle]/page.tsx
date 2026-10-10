import Link from "next/link";
import { Track } from "@/components/Track";
import { bundlesForProduct, getActiveProductByHandle, NotFoundError, percentOff, productPhotos, productQuestions, productReviews, recentlyViewed, sizeChartForProduct, sizeChartRows, upsellsFor, wholesaleTermsFor } from "@sf/core";
import { SizeChartDialog } from "@/components/SizeChartDialog";
import { RecentlyViewed } from "@/components/RecentlyViewed";
import { RememberView } from "@/components/RememberView";
import { readRecent, recentCookie } from "@/lib/recent";
import { ProductGallery } from "@/components/ProductGallery";
import { currentBuyer } from "@/lib/buyer";
import { db } from "@/lib/server";
import { buyerFx } from "@/lib/currency";
import { SubmitButton } from "@/components/SubmitButton";
import { addBundleAction, addToCartAction, askQuestionAction, stockAlertAction, toggleSavedAction } from "../../actions";
import { savedIds } from "@/lib/saved";
import { loadShop, localProducts, storeBase, storeLang, storeT, missing } from "../../data";
import { Price } from "@/components/Price";

async function load(shopHandle: string, handle: string, count = true) {
  const shop = await loadShop(shopHandle);
  try {
    const product = await getActiveProductByHandle(await db(), shop.id, handle);
    return { shop, product: (await localProducts(shopHandle, [product]))[0]! };
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

const ALERT_MESSAGES = {
  sent: { key: "alertSent", ok: true },
  back: { key: "alertBack", ok: true },
  many: { key: "alertMany", ok: false },
  invalid: { key: "alertInvalid", ok: false },
} as const;

const ASKED_MESSAGES = {
  sent: { key: "askSent", ok: true },
  many: { key: "askMany", ok: false },
  invalid: { key: "askInvalid", ok: false },
} as const;

export default async function ProductPage({ params, searchParams }: { params: Promise<{ shop: string; handle: string }>; searchParams: Promise<{ alert?: string; saved?: string; asked?: string }> }) {
  const { shop: shopHandle, handle } = await params;
  const query = await searchParams;
  const t = await storeT(shopHandle);
  const alertKind = ALERT_MESSAGES[(query.alert ?? "") as keyof typeof ALERT_MESSAGES];
  const alert = alertKind ? { text: t[alertKind.key], ok: alertKind.ok } : undefined;
  const { shop, product } = await load(shopHandle, handle);
  const buyable = product.variants.filter((x) => x.stock === null || x.stock > 0);
  const v = buyable[0] ?? product.variants[0];
  const many = product.variants.length > 1;
  const [reviews, questions, rawUpsells, base, fx, chart, rawRecent] = await Promise.all([
    productReviews(await db(), product.id),
    productQuestions(await db(), product.id),
    upsellsFor(await db(), shop.id, [product.id]),
    storeBase(shopHandle),
    buyerFx(shop),
    sizeChartForProduct(await db(), shop.id, product.id),
    readRecent(shop.id).then(async (ids) => recentlyViewed(await db(), shop.id, ids, { exclude: [product.id] })),
  ]);
  const recent = await localProducts(shopHandle, rawRecent);
  const askedKind = ASKED_MESSAGES[(query.asked ?? "") as keyof typeof ASKED_MESSAGES];
  const upsells = await localProducts(shopHandle, rawUpsells);
  const buyer = await currentBuyer(shop.id);
  const wholesale = await wholesaleTermsFor(await db(), shop, buyer?.email);
  const soldOut = product.variants.filter((x) => x.stock !== null && x.stock <= 0);
  const isSaved = (await savedIds(shop.id)).includes(product.id);
  const tiers = wholesale ? [] : product.quantityBreaks;
  // Wholesale buyers have their own prices, so bundles aren't offered to them.
  const bundles = wholesale ? [] : await bundlesForProduct(await db(), shop.id, product.id);
  const bundleTitles = new Map((await localProducts(shopHandle, bundles.flatMap((b) => b.products))).map((p) => [p.id, p.title]));
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
            <Stars value={reviews.average ?? 0} label={t.stars(reviews.average ?? 0)} />
            <span className="hint">{reviews.average} · {t.reviewCount(reviews.count)}</span>
          </a>
        )}
        {v && <div className="text-xl"><Price minor={v.priceMinor} compareAt={v.compareAtMinor} currency={shop.currency} fx={fx} /></div>}
        {product.sale && (
          <p className="text-sm font-semibold text-success" role="status">
            {t.saleNote(product.sale.percentOff, product.sale.endsAt ? new Intl.DateTimeFormat((await storeLang(shopHandle)) ?? "en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(product.sale.endsAt) : null)}
          </p>
        )}
        {v && wholesale && (
          <p className="banner banner-info" role="status">
            {t.wholesalePrice} <strong className="num"><Price minor={percentOff(v.priceMinor, wholesale.percentOff)} currency={shop.currency} fx={fx} /></strong> ({t.percentOff(wholesale.percentOff)})
          </p>
        )}
        {v && tiers.length > 0 && (
          <section aria-labelledby="bulk" className="card p-4 flex flex-col gap-2">
            <h2 id="bulk" className="font-semibold">{t.buyMore}</h2>
            <ul className="text-sm flex flex-col gap-1">
              {tiers.map((tier) => (
                <li key={tier.minQty} className="flex justify-between gap-3">
                  <span>{t.buyQty(tier.minQty, tier.percentOff)}</span>
                  <span className="num"><Price minor={percentOff(v.priceMinor, tier.percentOff)} currency={shop.currency} fx={fx} /> {t.each}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {v && buyable.length > 0 && (
          <form action={addToCartAction.bind(null, shopHandle)} className="flex flex-col gap-4">
            {many ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="label mb-2">{t.option}</legend>
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
                <label className="label" htmlFor="quantity">{t.quantity}</label>
                <input className="input num" id="quantity" name="quantity" type="number" min={1} max={99} defaultValue={1} />
              </div>
            ) : (
              <input type="hidden" name="quantity" value="1" />
            )}
            <SubmitButton className="btn btn-primary btn-lg" pendingText={t.adding}>{t.addToCart}</SubmitButton>
          </form>
        )}
        {v && buyable.length === 0 && <p className="banner banner-info">{t.soldOutForNow}</p>}
        {chart && (
          <SizeChartDialog
            chart={{ name: chart.name, unit: chart.unit, columns: chart.columns, rows: { cm: sizeChartRows(chart, "cm"), in: sizeChartRows(chart, "in") }, note: chart.note }}
            t={{ sizeChart: t.sizeChart, close: t.close, centimetres: t.centimetres, inches: t.inches }}
          />
        )}
        <form action={toggleSavedAction.bind(null, shopHandle, product.id, "product")} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="handle" value={product.handle} />
          <input type="hidden" name="save" value={isSaved ? "0" : "1"} />
          <button className="btn btn-secondary" aria-pressed={isSaved}>
            <span aria-hidden className={isSaved ? "text-critical" : ""}>{isSaved ? "♥" : "♡"}</span> {isSaved ? t.saved : t.saveForLater}
          </button>
          {query.saved === "saved" && isSaved && (
            <span role="status" className="text-sm">
              {t.savedDone} <Link href={`${base}/saved`} className="underline">{t.seeSaved}</Link>
              {!buyer && <span className="hint"> · {t.signInForDrops}</span>}
            </span>
          )}
          {query.saved === "full" && <span role="status" className="text-sm text-critical">{t.savedFull}</span>}
        </form>
        {(soldOut.length > 0 || alert) && (
          <form id="stock-alert" action={stockAlertAction.bind(null, shopHandle, product.handle)} className="card p-4 flex flex-col gap-3" aria-labelledby="stock-alert-h">
            <h2 id="stock-alert-h" className="font-semibold">{buyable.length === 0 ? t.alertTitle : t.alertTitleOption}</h2>
            {alert && <p role="status" className={`banner ${alert.ok ? "banner-success" : "banner-critical"}`}>{alert.text}</p>}
            {soldOut.length > 0 && (
              <>
                {soldOut.length === 1 && !many ? (
                  <input type="hidden" name="variantId" value={soldOut[0]!.id} />
                ) : (
                  <div className="field">
                    <label className="label" htmlFor="alert-variant">{t.option}</label>
                    <select className="input" id="alert-variant" name="variantId">
                      {soldOut.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                    </select>
                  </div>
                )}
                <div className="flex flex-wrap gap-2 items-end">
                  <div className="field flex-1 min-w-48">
                    <label className="label" htmlFor="alert-email">{t.email}</label>
                    <input className="input" id="alert-email" name="email" type="email" required autoComplete="email" defaultValue={buyer?.email ?? ""} placeholder="you@example.com" />
                  </div>
                  <SubmitButton className="btn btn-secondary">{t.notifyMe}</SubmitButton>
                </div>
                <p className="hint text-sm">{t.alertNote}</p>
              </>
            )}
          </form>
        )}
        {v?.shipDaysMin != null && v.shipDaysMax != null && (
          <p className="text-sm">{t.arrivesIn(v.shipDaysMin, v.shipDaysMax)}</p>
        )}
        {product.descriptionHtml && <div className="text-muted whitespace-pre-line leading-relaxed">{product.descriptionHtml}</div>}
        <ul className="hint flex flex-col gap-1 border-t border-border pt-4">
          <li>{t.secureCheckout}</li>
          <li>{t.questions}</li>
        </ul>
        {bundles.map((b) => (
          <section key={b.id} className="card p-4 flex flex-col gap-3" aria-labelledby={`bundle-${b.id}`}>
            <div>
              <h2 id={`bundle-${b.id}`} className="font-semibold">{t.bundleHeading(b.percentOff)}</h2>
              <p className="hint text-sm">{b.title}</p>
            </div>
            <form action={addBundleAction.bind(null, shopHandle, b.id)} className="flex flex-col gap-3">
              <ul className="flex flex-col gap-2">
                {b.products.map((p) => {
                  const title = bundleTitles.get(p.id) ?? p.title;
                  const options = p.variants.filter((x) => x.available);
                  return (
                    <li key={p.id} className="flex items-center gap-3">
                      <span className="size-12 rounded-md bg-sunken overflow-hidden shrink-0">{p.imageUrl && <img src={p.imageUrl} alt="" className="size-full object-cover" />}</span>
                      <span className="flex-1 min-w-0 flex flex-col gap-1">
                        {p.id === product.id ? <span className="text-sm font-medium">{title}</span> : <Link href={`${base}/products/${p.handle}`} className="text-sm font-medium hover:underline">{title}</Link>}
                        {options.length > 1 && (
                          <select name={`v_${p.id}`} aria-label={t.bundleOption(title)} className="input py-1 text-sm" defaultValue={p.id === product.id ? v?.id : options[0]!.id}>
                            {options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                          </select>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="flex items-baseline gap-2 text-sm">{t.bundleTogether}: <Price minor={b.bundleMinor} compareAt={b.fullMinor} currency={shop.currency} fx={fx} /></p>
              <SubmitButton className="btn btn-secondary" pendingText={t.adding}>{t.bundleAdd(b.products.length)}</SubmitButton>
            </form>
          </section>
        ))}
        {upsells.length > 0 && (
          <section className="flex flex-col gap-3 border-t border-border pt-4" aria-labelledby="goes-well">
            <h2 id="goes-well" className="font-semibold">{t.goesWellWith}</h2>
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
        <h2 id="reviews-heading" className="text-xl font-semibold">{t.reviews}</h2>
        {reviews.count === 0 ? (
          <p className="hint">{t.noReviews}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {reviews.reviews.map((r) => (
              <li key={r.id} className="card p-4 flex flex-col gap-2">
                <div className="flex items-center gap-2"><Stars value={r.rating} label={t.stars(r.rating)} /><span className="font-medium text-sm">{r.name}</span></div>
                <p className="text-sm whitespace-pre-line">{r.body}</p>
                {r.reply && <p className="text-sm hint border-l-2 border-border pl-3"><span className="font-medium">{shop.name}: </span>{r.reply}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section id="questions" className="md:col-span-2 flex flex-col gap-4 border-t border-border pt-8" aria-labelledby="questions-heading">
        <h2 id="questions-heading" className="text-xl font-semibold">{t.productQuestions}</h2>
        {questions.length === 0 ? (
          <p className="hint">{t.noQuestions}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {questions.map((q) => (
              <li key={q.id} className="flex flex-col gap-1">
                <p className="font-medium whitespace-pre-line">{q.body} <span className="hint font-normal text-sm">· {q.name.split(/\s+/)[0]}</span></p>
                <p className="text-sm whitespace-pre-line border-l-2 border-border pl-3"><span className="font-medium">{shop.name}: </span>{q.answer}</p>
              </li>
            ))}
          </ul>
        )}
        <form action={askQuestionAction.bind(null, shopHandle, product.handle, product.id)} className="card p-4 flex flex-col gap-3 max-w-2xl" aria-labelledby="ask-heading">
          <h3 id="ask-heading" className="font-semibold">{t.askTitle}</h3>
          {askedKind && <p role="status" className={`banner ${askedKind.ok ? "banner-success" : "banner-critical"}`}>{t[askedKind.key]}</p>}
          <div className="field">
            <label className="label" htmlFor="ask-question">{t.yourQuestion}</label>
            <textarea className="input" id="ask-question" name="question" rows={3} required minLength={10} maxLength={500} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="field">
              <label className="label" htmlFor="ask-name">{t.yourName}</label>
              <input className="input" id="ask-name" name="name" required maxLength={60} autoComplete="given-name" />
            </div>
            <div className="field">
              <label className="label" htmlFor="ask-email">{t.email}</label>
              <input className="input" id="ask-email" name="email" type="email" required autoComplete="email" defaultValue={buyer?.email ?? ""} placeholder="you@example.com" />
            </div>
          </div>
          <p className="hint text-sm">{t.askNote}</p>
          <SubmitButton className="btn btn-secondary self-start">{t.askButton}</SubmitButton>
        </form>
      </section>
      <RecentlyViewed items={recent} base={base} currency={shop.currency} fx={fx} title={t.recentlyViewed} soldOut={t.soldOut} className="md:col-span-2 border-t border-border pt-8" />
      <RememberView cookie={recentCookie(shop.id)} productId={product.id} />
    </main>
  );
}

function Stars({ value, label }: { value: number; label: string }) {
  const full = Math.round(value);
  return (
    <span className="text-warning tracking-tight" role="img" aria-label={label}>
      {"★".repeat(full)}
      <span className="text-border">{"★".repeat(5 - full)}</span>
    </span>
  );
}
