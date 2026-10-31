import Link from "next/link";
import { formatMoney, listSavedReplies, REVIEW_PAGE_SIZE, reviewRewardStats, reportedReviewCount, reviewCounts, reviewPage, reviewPhotoUrl, reviewRequestStats } from "@sf/core";
import { requireShop } from "@/lib/server";
import { keepReportedReviewAction, moderateReviewAction, removeReviewPhotoAction, setReviewsAutoPublishAction } from "../../growth-actions";
import { PageHeader } from "../PageHeader";
import { ReplyForm } from "./ReplyForm";
import { ReviewRequestForm } from "./ReviewRequestForm";
import { ReviewRewardForm } from "./ReviewRewardForm";

export const metadata = { title: "Reviews" };

const TABS = [
  { key: "pending", label: "Waiting" },
  { key: "published", label: "Published" },
  { key: "hidden", label: "Hidden" },
] as const;

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ show?: string; stars?: string; q?: string; page?: string; reply?: string; photos?: string; reported?: string; product?: string }> }) {
  const { shop, db } = await requireShop("reviews");
  const params = await searchParams;
  const status = TABS.find((t) => t.key === params.show)?.key ?? "pending";
  const stars = /^[1-5]$/.test(params.stars ?? "") ? Number(params.stars) : undefined;
  const q = params.q?.trim().slice(0, 100) || undefined;
  const page = /^\d{1,5}$/.test(params.page ?? "") ? Math.max(1, Number(params.page)) : 1;
  const noReply = params.reply === "none";
  const photos = params.photos === "1";
  // Reported reviews are always published (hiding one clears its reports), so this filter opens that tab.
  const reported = params.reported === "1" && status === "published";
  // From a product's page: only its reviews.
  const product = /^[0-9a-f-]{36}$/i.test(params.product ?? "")
    ? await db.query.products.findFirst({ where: (p, { and, eq }) => and(eq(p.id, params.product!), eq(p.shopId, shop.id)), columns: { id: true, title: true } })
    : undefined;
  const filtered = Boolean(q || stars || noReply || photos || reported || product);
  const [{ reviews: rows, total }, counts, requests, reportedCount, savedReplies, reward] = await Promise.all([
    reviewPage(db, shop.id, { status, rating: stars, query: q, page, noReply, photos, reported, productId: product?.id }),
    reviewCounts(db, shop.id),
    reviewRequestStats(db, shop.id),
    reportedReviewCount(db, shop.id),
    listSavedReplies(db, shop.id),
    reviewRewardStats(db, shop.id),
  ]);
  const saved = savedReplies.map(({ id, title, body }) => ({ id, title, body }));
  // What a saved reply's fields become for one review. A name erased to "Verified buyer" isn't one.
  const replyValues = (name: string, orderNumber: number | null) => ({
    "{first_name}": name === "Verified buyer" ? "there" : name.trim().split(/\s+/)[0] || "there",
    "{store_name}": shop.name,
    ...(orderNumber != null ? { "{order_number}": `#${orderNumber}` } : {}),
  });
  const pages = Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE));
  const href = (change: { show?: string; stars?: number | null; q?: string | null; page?: number; noReply?: boolean; photos?: boolean; reported?: boolean; product?: boolean }) => {
    const next = new URLSearchParams({ show: change.show ?? status });
    const s = change.stars === undefined ? stars : change.stars;
    if (s) next.set("stars", String(s));
    const query = change.q === undefined ? q : change.q;
    if (query) next.set("q", query);
    if (change.noReply ?? noReply) next.set("reply", "none");
    if (change.photos ?? photos) next.set("photos", "1");
    if (change.reported ?? reported) next.set("reported", "1");
    if (product && change.product !== false) next.set("product", product.id);
    if (change.page && change.page > 1) next.set("page", String(change.page));
    return `/admin/reviews?${next}`;
  };
  // The download takes what's on screen: this tab with its stars, search and filters.
  const download = `/admin/reviews/export.csv?${href({}).split("?")[1]}`;

  return (
    <main className="pb-12">
      <PageHeader title="Reviews" actions={<a href={download} className="btn btn-secondary" download>Download these (CSV)</a>} />
      <div className="px-4 sm:px-8 flex flex-col gap-4 max-w-3xl">
        <p className="hint">
          Only buyers whose order has shipped can review, so every review is from a real customer. The shipping email asks them for one, and a review request follows once it has arrived.
          {" "}Moving from Shopify? <Link href="/admin/products/move#reviews-heading" className="underline">Bring your reviews over</Link>.
          {" "}Your reviews are yours too: <a href="/admin/reviews/export.csv" className="underline" download>download every review</a> in the same format.
        </p>
        <form action={setReviewsAutoPublishAction} className="card p-4 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2 flex-1 min-w-60">
            <input type="checkbox" name="reviewsAutoPublish" defaultChecked={shop.reviewsAutoPublish} />
            Publish new reviews straight away
            <span className="hint">(you can still hide one later)</span>
          </label>
          <button className="btn btn-secondary">Save</button>
        </form>
        <section className="card p-4 flex flex-col gap-2" aria-labelledby="requests-heading">
          <h2 id="requests-heading" className="font-semibold">Review requests</h2>
          <ReviewRequestForm days={shop.reviewRequestDays} />
          {requests.sent > 0 && (
            <p className="hint text-sm">
              Last 30 days: {requests.sent} sent, and {requests.reviewed} of those orders got a review.
            </p>
          )}
        </section>
        <section className="card p-4 flex flex-col gap-2" aria-labelledby="reward-heading">
          <h2 id="reward-heading" className="font-semibold">Thank-you code</h2>
          <ReviewRewardForm percent={shop.reviewRewardPercent} />
          {reward.sent > 0 && (
            <p className="hint text-sm">
              {reward.sent === 1 ? "1 code sent" : `${reward.sent} codes sent`}, {reward.used} used, {formatMoney(reward.salesMinor, shop.currency)} in sales.
            </p>
          )}
        </section>
        <nav className="flex gap-1 border-b border-border overflow-x-auto" aria-label="Review status">
          {TABS.map((t) => (
            <Link key={t.key} href={href({ show: t.key, stars: null, q: null, noReply: false, photos: false, reported: false })} aria-current={t.key === status ? "page" : undefined}
              className={`px-3 py-2 text-sm -mb-px border-b-2 whitespace-nowrap ${t.key === status ? "border-accent font-semibold" : "border-transparent hint"}`}>
              {t.label} <span className="num hint">({counts[t.key]})</span>
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <form action="/admin/reviews" className="flex gap-2 flex-1 min-w-60" role="search">
            <input type="hidden" name="show" value={status} />
            {stars && <input type="hidden" name="stars" value={stars} />}
            {noReply && <input type="hidden" name="reply" value="none" />}
            {photos && <input type="hidden" name="photos" value="1" />}
            {reported && <input type="hidden" name="reported" value="1" />}
            {product && <input type="hidden" name="product" value={product.id} />}
            <label htmlFor="review-q" className="sr-only">Search reviews</label>
            <input id="review-q" name="q" type="search" defaultValue={q} placeholder="Name, words or product" className="input flex-1" />
            <button className="btn btn-secondary">Search</button>
          </form>
          <nav className="flex flex-wrap gap-1 text-sm" aria-label="Star filter">
            <Link href={href({ stars: null, page: 1 })} aria-current={!stars ? "page" : undefined} className={`px-2 py-1 rounded-md ${!stars ? "bg-sunken font-semibold" : "hint"}`}>All stars</Link>
            {[5, 4, 3, 2, 1].map((n) => (
              <Link key={n} href={href({ stars: n, page: 1 })} aria-current={stars === n ? "page" : undefined} aria-label={`${n} star${n > 1 ? "s" : ""}`}
                className={`px-2 py-1 rounded-md num ${stars === n ? "bg-sunken font-semibold" : "hint"}`}>{n}★</Link>
            ))}
          </nav>
          <nav className="flex flex-wrap gap-1 text-sm" aria-label="More filters">
            <Link href={href({ noReply: !noReply, page: 1 })} aria-current={noReply ? "true" : undefined} className={`px-2 py-1 rounded-md ${noReply ? "bg-sunken font-semibold" : "hint"}`}>No reply yet</Link>
            <Link href={href({ photos: !photos, page: 1 })} aria-current={photos ? "true" : undefined} className={`px-2 py-1 rounded-md ${photos ? "bg-sunken font-semibold" : "hint"}`}>With photos</Link>
            {(reportedCount > 0 || reported) && (
              <Link href={href({ show: "published", reported: !reported, page: 1 })} aria-current={reported ? "true" : undefined} className={`px-2 py-1 rounded-md ${reported ? "bg-sunken font-semibold" : "text-critical"}`}>
                Reported <span className="num">({reportedCount})</span>
              </Link>
            )}
          </nav>
        </div>
        {filtered && (
          <p className="hint text-sm">
            {total} {total === 1 ? "review matches" : "reviews match"}{q && <> &ldquo;{q}&rdquo;</>}{stars && <> with {stars} star{stars > 1 ? "s" : ""}</>}{noReply && <>, no reply yet</>}{photos && <>, with photos</>}{reported && <>, reported by shoppers</>}{product && <> for <Link href={`/admin/products/${product.id}`} className="underline">{product.title}</Link></>}. <Link href={href({ stars: null, q: null, noReply: false, photos: false, reported: false, product: false })} className="underline">Clear</Link>
          </p>
        )}
        {rows.length === 0 ? (
          <p className="hint py-6 text-center">{filtered ? "No reviews match." : status === "pending" ? "Nothing waiting. New reviews show up here." : "None here."}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map(({ review: r, productTitle, orderNumber }) => (
              <li key={r.id} className="card p-4 flex flex-col gap-2" aria-label={`Review by ${r.name}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="text-warning" role="img" aria-label={`${r.rating} out of 5 stars`}>{"★".repeat(r.rating)}<span className="text-border">{"★".repeat(5 - r.rating)}</span></span>
                  <span className="font-medium">{r.name}</span>
                  <span className="hint">on {productTitle} · {orderNumber != null ? `order #${orderNumber}` : `from ${r.importedFrom ?? "another platform"}`} · {r.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                </div>
                {r.reportCount > 0 && (
                  <div className="banner banner-critical text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex-1 min-w-48">Reported by {r.reportCount === 1 ? "a shopper" : `${r.reportCount} shoppers`}. It stays up until you hide it.</span>
                    <form action={keepReportedReviewAction.bind(null, r.id)}><button className="underline">Keep it</button></form>
                  </div>
                )}
                <p className="text-sm whitespace-pre-line">{r.body}</p>
                {r.photoIds.length > 0 && (
                  <ul className="flex flex-wrap gap-3" aria-label="Buyer's photos">
                    {r.photoIds.map((photo, i) => (
                      <li key={photo} className="flex flex-col items-start gap-1">
                        <a href={reviewPhotoUrl(photo)} target="_blank"><img src={reviewPhotoUrl(photo)} alt={`Photo ${i + 1} from ${r.name}`} className="size-24 rounded-md object-cover border border-border" /></a>
                        <form action={removeReviewPhotoAction.bind(null, r.id, photo)}>
                          <button className="text-xs text-critical hover:underline" aria-label={`Remove photo ${i + 1} from ${r.name}`}>Remove</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
                <ReplyForm id={r.id} reply={r.reply} saved={saved} values={replyValues(r.name, orderNumber)} />
                <div className="flex gap-2">
                  {r.status !== "published" && (
                    <form action={moderateReviewAction.bind(null, r.id, "published")}><button className="btn btn-primary">Publish</button></form>
                  )}
                  {r.status !== "hidden" && (
                    <form action={moderateReviewAction.bind(null, r.id, "hidden")}><button className="btn btn-secondary">Hide</button></form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && (
          <nav aria-label="Pages" className="flex items-center gap-3 text-sm">
            {page > 1 && <Link href={href({ page: page - 1 })} className="btn btn-secondary">← Newer</Link>}
            <span className="hint num">Page {Math.min(page, pages)} of {pages}</span>
            {page < pages && <Link href={href({ page: page + 1 })} className="btn btn-secondary ml-auto">Older →</Link>}
          </nav>
        )}
      </div>
    </main>
  );
}
