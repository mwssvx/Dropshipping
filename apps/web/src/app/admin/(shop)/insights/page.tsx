import Link from "next/link";
import { AI_REPORT_AREAS, listAiReports, TRENDS_MAX_SEARCHES, type AiReportArea } from "@sf/core";
import type { AiReportItem } from "@sf/db";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { FindTrendsForm, ReviewStoreButton } from "./InsightsForms";

export const metadata = { title: "Insights" };

const IMPACT: Record<AiReportItem["impact"], [string, string]> = {
  high: ["Big difference", "pill-success"],
  medium: ["Worth doing", "pill-info"],
  low: ["Small win", "pill-neutral"],
};
const CONFIDENCE: Record<AiReportItem["impact"], [string, string]> = {
  high: ["Strong signal", "pill-success"],
  medium: ["Some signal", "pill-info"],
  low: ["Early signal", "pill-neutral"],
};
const when = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

function Suggestions({ items }: { items: AiReportItem[] }) {
  return (
    <ol className="flex flex-col divide-y divide-border">
      {items.map((it, i) => {
        const area = it.area ? AI_REPORT_AREAS[it.area as AiReportArea] : null;
        return (
          <li key={i} className="py-3 flex flex-col gap-1.5">
            <div className="flex gap-2 items-baseline justify-between flex-wrap">
              <h3 className="font-medium">{i + 1}. {it.title}</h3>
              <span className={`pill ${(IMPACT[it.impact] ?? IMPACT.low)[1]}`}>{(IMPACT[it.impact] ?? IMPACT.low)[0]}</span>
            </div>
            <p className="text-sm hint">{it.finding}</p>
            <p className="text-sm">{it.action}</p>
            {area && <Link className="text-sm font-medium text-accent hover:underline self-start" href={area.path}>Go to {area.label}</Link>}
          </li>
        );
      })}
    </ol>
  );
}

function Ideas({ items }: { items: AiReportItem[] }) {
  return (
    <ol className="flex flex-col divide-y divide-border">
      {items.map((it, i) => {
        const [label, pill] = CONFIDENCE[it.impact] ?? CONFIDENCE.low;
        return (
          <li key={i} className="py-3 flex flex-col gap-1.5">
            <div className="flex gap-2 items-baseline justify-between flex-wrap">
              <h3 className="font-medium">{it.title}</h3>
              <span className={`pill ${pill}`}>{label}</span>
            </div>
            <p className="text-sm hint">{it.finding}</p>
            <p className="text-sm">{it.action}</p>
            {!!it.sources?.length && (
              <p className="text-xs hint flex flex-wrap gap-x-3">
                Sources:
                {it.sources.map((src) => (
                  <a key={src.url} className="underline" href={src.url} target="_blank" rel="noopener noreferrer nofollow">{src.title}</a>
                ))}
              </p>
            )}
            {it.search && (
              <p className="text-sm flex flex-wrap gap-x-4">
                <a className="font-medium text-accent hover:underline" href={`https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(it.search)}`} target="_blank" rel="noopener noreferrer">Find “{it.search}” on AliExpress ↗</a>
                <Link className="font-medium text-accent hover:underline" href="/admin/products/import">Import a product</Link>
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default async function InsightsPage() {
  const { shop, db } = await requireShop("analytics");
  const [[latest, ...earlier], [trends]] = await Promise.all([listAiReports(db, shop.id, "review"), listAiReports(db, shop.id, "trends", 1)]);
  return (
    <main className="pb-12">
      <PageHeader title="Insights" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <section className="card p-5 flex flex-col gap-4" aria-labelledby="review-title">
          <div className="flex flex-col gap-1">
            <h2 id="review-title" className="font-semibold">Store review</h2>
            <p className="hint text-sm">
              The business analyst reads your sales, profit, products, customers, returns and what shoppers search for, then picks the few things most worth doing next. It uses a few cents of your AI budget.{" "}
              {shop.aiWeeklyReview ? "It also runs every Monday." : <>You can have it run every Monday in <Link className="underline" href="/admin/ai">AI settings</Link>.</>}
            </p>
          </div>
          <ReviewStoreButton again={!!latest} />
          {latest && (
            <div className="flex flex-col gap-2">
              <p className="hint text-xs">{when.format(latest.createdAt)}</p>
              <p>{latest.summary}</p>
              <Suggestions items={latest.items} />
            </div>
          )}
        </section>
        <section className="card p-5 flex flex-col gap-4" aria-labelledby="trends-title">
          <div className="flex flex-col gap-1">
            <h2 id="trends-title" className="font-semibold">Trending products</h2>
            <p className="hint text-sm">
              The trend scout searches what&apos;s taking off on TikTok, Instagram, Google, Amazon and Reddit, checks it against what your store sells and what your shoppers searched for, and suggests products to add, with its sources. Up to {TRENDS_MAX_SEARCHES} web searches and a few cents of your AI budget, once a day.
            </p>
          </div>
          <FindTrendsForm again={!!trends} />
          {trends && (
            <div className="flex flex-col gap-2">
              <p className="hint text-xs">{when.format(trends.createdAt)}</p>
              <p>{trends.summary}</p>
              <Ideas items={trends.items} />
            </div>
          )}
        </section>
        {earlier.length > 0 && (
          <section className="card p-5 flex flex-col gap-2" aria-labelledby="earlier-title">
            <h2 id="earlier-title" className="font-semibold">Earlier store reviews</h2>
            {earlier.map((r) => (
              <details key={r.id} className="py-1">
                <summary className="cursor-pointer text-sm">{when.format(r.createdAt)}: {r.items.length} suggestion{r.items.length === 1 ? "" : "s"}</summary>
                <p className="text-sm mt-2">{r.summary}</p>
                <Suggestions items={r.items} />
              </details>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
