import Link from "next/link";
import { listReviews } from "@sf/core";
import { requireShop } from "@/lib/server";
import { moderateReviewAction, setReviewsAutoPublishAction } from "../../growth-actions";
import { PageHeader } from "../PageHeader";
import { ReplyForm } from "./ReplyForm";

export const metadata = { title: "Reviews" };

const TABS = [
  { key: "pending", label: "Waiting" },
  { key: "published", label: "Published" },
  { key: "hidden", label: "Hidden" },
] as const;

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { shop, db } = await requireShop();
  const { show } = await searchParams;
  const status = TABS.find((t) => t.key === show)?.key ?? "pending";
  const rows = await listReviews(db, shop.id, { status });

  return (
    <main className="pb-12">
      <PageHeader title="Reviews" />
      <div className="px-4 sm:px-8 flex flex-col gap-4 max-w-3xl">
        <p className="hint">
          Only buyers whose order has shipped can review, so every review is from a real customer. The delivery email asks them for one.
        </p>
        <form action={setReviewsAutoPublishAction} className="card p-4 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2 flex-1 min-w-60">
            <input type="checkbox" name="reviewsAutoPublish" defaultChecked={shop.reviewsAutoPublish} />
            Publish new reviews straight away
            <span className="hint">(you can still hide one later)</span>
          </label>
          <button className="btn btn-secondary">Save</button>
        </form>
        <nav className="flex gap-1 border-b border-border" aria-label="Review status">
          {TABS.map((t) => (
            <Link key={t.key} href={`/admin/reviews?show=${t.key}`} aria-current={t.key === status ? "page" : undefined}
              className={`px-3 py-2 text-sm -mb-px border-b-2 ${t.key === status ? "border-accent font-semibold" : "border-transparent hint"}`}>
              {t.label}
            </Link>
          ))}
        </nav>
        {rows.length === 0 ? (
          <p className="hint py-6 text-center">{status === "pending" ? "Nothing waiting. New reviews show up here." : "None here."}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map(({ review: r, productTitle, orderNumber }) => (
              <li key={r.id} className="card p-4 flex flex-col gap-2" aria-label={`Review by ${r.name}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="text-warning" role="img" aria-label={`${r.rating} out of 5 stars`}>{"★".repeat(r.rating)}<span className="text-border">{"★".repeat(5 - r.rating)}</span></span>
                  <span className="font-medium">{r.name}</span>
                  <span className="hint">on {productTitle} · order #{orderNumber} · {r.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                </div>
                <p className="text-sm whitespace-pre-line">{r.body}</p>
                <ReplyForm id={r.id} reply={r.reply} />
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
      </div>
    </main>
  );
}
