import Link from "next/link";
import { formatMoney, surveyReport } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { SurveyForm } from "./SurveyForm";

export const metadata = { title: "Buyer survey" };

const RANGES = [30, 90, 365] as const;

export default async function SurveyPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { shop, db } = await requireShop("marketing");
  const { days: raw } = await searchParams;
  const days = RANGES.find((d) => String(d) === raw) ?? 30;
  const r = await surveyReport(db, shop.id, days);
  const money = (m: number) => formatMoney(m, shop.currency);
  return (
    <main className="pb-12">
      <PageHeader title="Buyer survey" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-4xl">
        <p className="text-muted">
          Ask buyers how they found you, once, on their order page right after paying. Ads only count clicks, so this is where word of mouth,
          podcasts and videos people watched without clicking show up.
        </p>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="survey-setup">
          <h2 id="survey-setup" className="font-semibold">{shop.survey ? "The question" : "Start asking"}</h2>
          <SurveyForm survey={shop.survey} />
        </section>

        <section className="card overflow-x-auto" aria-labelledby="survey-answers">
          <div className="px-5 pt-4 pb-2 flex flex-wrap gap-3 items-center justify-between">
            <h2 id="survey-answers" className="font-semibold">What buyers said</h2>
            <nav aria-label="Period" className="flex gap-2">
              {RANGES.map((d) => (
                <Link key={d} href={`/admin/survey?days=${d}`} className={`btn btn-sm ${d === days ? "btn-primary" : "btn-secondary"}`} aria-current={d === days ? "page" : undefined}>
                  {d === 365 ? "Last year" : `Last ${d} days`}
                </Link>
              ))}
            </nav>
          </div>
          <p className="hint px-5 pb-2">
            {r.answered} of {r.orders === 1 ? "1 order" : `${r.orders} orders`} answered{r.orders ? ` (${Math.round((r.answered / r.orders) * 100)}%)` : ""}.
          </p>
          {r.rows.length ? (
            <table className="table">
              <thead>
                <tr><th>Answer</th><th className="text-right">Orders</th><th className="text-right">Share</th><th className="text-right">Sales</th></tr>
              </thead>
              <tbody>
                {r.rows.map((row) => (
                  <tr key={row.answer}>
                    <td className="font-medium">{row.answer}</td>
                    <td className="text-right num">{row.orders}</td>
                    <td className="text-right num">{Math.round(row.share * 100)}%</td>
                    <td className="text-right num">{money(row.revenueMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-5 pb-5 hint">No answers yet.</p>
          )}
        </section>

        {r.others.length > 0 && (
          <section className="card p-5 flex flex-col gap-2" aria-labelledby="survey-others">
            <h2 id="survey-others" className="font-semibold">In their own words</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {r.others.map((o) => (
                <li key={o.number}><span className="hint num mr-2">#{o.number}</span>{o.text}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
