import Link from "next/link";
import { DISPUTE_RATE_LIMIT, disputeReason, disputeStats, formatMoney, listDisputes } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";

export const metadata = { title: "Disputes" };

const STATUS = { needs_response: "Needs your answer", under_review: "Bank reviewing", won: "Won", lost: "Lost", closed: "Closed" } as const;
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const percent = (r: number) => `${(r * 100).toFixed(r && r < 0.01 ? 2 : 1)}%`;

export default async function DisputesPage() {
  const { shop, db } = await requireShop("money");
  const [disputes, stats] = await Promise.all([listDisputes(db, shop.id), disputeStats(db, shop.id)]);
  const money = (m: number) => formatMoney(m, shop.currency);
  const high = stats.rate >= DISPUTE_RATE_LIMIT;
  return (
    <main className="pb-12">
      <PageHeader title="Disputes" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-4xl">
        <p className="text-sm">
          When a buyer asks their bank for their money back, it shows up here and we email you. We put the evidence together from the
          order (tracking, delivery, your returns policy and messages with the buyer), so answering takes a minute.
        </p>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 card p-5 text-sm" aria-label="Dispute summary">
          <div><dt className="hint">Need your answer</dt><dd className="text-lg font-semibold num">{stats.open}</dd></div>
          <div><dt className="hint">Money held</dt><dd className="text-lg font-semibold num">{money(stats.atStakeMinor)}</dd></div>
          <div><dt className="hint">Won · lost</dt><dd className="text-lg font-semibold num">{stats.won} · {stats.lost}</dd></div>
          <div><dt className="hint">Dispute rate, 90 days</dt><dd className={`text-lg font-semibold num ${high ? "text-critical" : ""}`}>{percent(stats.rate)}</dd></div>
        </dl>
        {high && (
          <p className="banner banner-warning">
            {stats.recent} disputes on {stats.orders} orders in 90 days is above {percent(DISPUTE_RATE_LIMIT)}, which the payment processor treats as too
            high and can lead to payouts being held. Clear delivery dates, tracking emails and an easy returns page help most.
          </p>
        )}
        {disputes.length ? (
          <ul className="card divide-y divide-border" aria-label="Disputes">
            {disputes.map((d) => {
              const label = d.orderNumber ? `Order #${d.orderNumber}` : "A payment";
              return (
                <li key={d.id} className="p-4 flex flex-wrap items-center justify-between gap-3 text-sm" aria-label={label}>
                  <div className="flex flex-col gap-1 min-w-56">
                    <span className="font-medium">
                      {d.orderId ? <Link href={`/admin/orders/${d.orderId}#dispute`} className="underline">{label}</Link> : label}
                      {d.inquiry && <span className="hint"> · question first</span>}
                    </span>
                    <span className="hint">{disputeReason(d.reason).label}{d.email ? ` · ${d.email}` : ""}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="num">{formatMoney(d.amountMinor, d.currency)}</span>
                    {d.status === "needs_response" && d.evidenceDueBy && <span className="hint">Answer by {date.format(d.evidenceDueBy)}</span>}
                    <span className={`pill ${d.status === "needs_response" || d.status === "lost" ? "pill-critical" : d.status === "won" ? "pill-success" : "pill-neutral"}`}>{STATUS[d.status]}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="hint">No disputes. That&apos;s how it should be.</p>
        )}
      </div>
    </main>
  );
}
