import Link from "next/link";
import { countSubscriptions, formatDeliveryDate, formatMoney, intervalLabel, listSubscriptions, SUBSCRIPTION_PAGE_SIZE, subscriptionStats, type SubscriptionFilter } from "@sf/core";
import { requireShop, testPayments } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { SubscriptionRowActions } from "./SubscriptionRowActions";

export const metadata = { title: "Subscriptions" };

const STATUS = { active: "Active", paused: "Paused", cancelled: "Cancelled" } as const;

const FILTERS: { key?: NonNullable<SubscriptionFilter["status"]>; label: string }[] = [
  { label: "All" },
  { key: "active", label: "Active" },
  { key: "failing", label: "Card problems" },
  { key: "paused", label: "Paused" },
  { key: "cancelled", label: "Cancelled" },
];

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<{ show?: string; q?: string; page?: string }> }) {
  const { shop, db } = await requireShop("orders");
  const params = await searchParams;
  const status = FILTERS.find((f) => f.key && f.key === params.show)?.key;
  const q = params.q?.trim().slice(0, 100) || undefined;
  const page = /^\d{1,5}$/.test(params.page ?? "") ? Math.max(1, Number(params.page)) : 1;
  const filter = { status, query: q };
  const [subs, total, failing, stats] = await Promise.all([
    listSubscriptions(db, shop.id, { ...filter, page }),
    countSubscriptions(db, shop.id, filter),
    countSubscriptions(db, shop.id, { status: "failing" }),
    subscriptionStats(db, shop.id),
  ]);
  const pages = Math.max(1, Math.ceil(total / SUBSCRIPTION_PAGE_SIZE));
  const href = (change: { show?: string | null; page?: number }) => {
    const next = new URLSearchParams();
    const show = change.show === undefined ? status : change.show;
    if (show) next.set("show", show);
    if (q) next.set("q", q);
    if (change.page && change.page > 1) next.set("page", String(change.page));
    const qs = next.toString();
    return `/admin/subscriptions${qs ? `?${qs}` : ""}`;
  };
  const filtered = Boolean(status || q);
  const money = (m: number) => formatMoney(m, shop.currency);
  const offer = shop.subscriptionOffer;
  return (
    <main className="pb-12">
      <PageHeader title="Subscriptions" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-4xl">
        <p className="text-sm">
          {offer?.active
            ? `Buyers can subscribe to their order for ${offer.percentOff}% off each delivery, from their order page.`
            : "Subscribe and save is off, so buyers can't start new subscriptions. The ones below carry on."}{" "}
          <Link href="/admin/marketing#subscribe-heading" className="underline">Change it on Marketing</Link>
        </p>
        <dl className="grid grid-cols-3 gap-3 card p-5 text-sm">
          <div><dt className="hint">Active</dt><dd className="text-lg font-semibold num">{stats.active}</dd></div>
          <div><dt className="hint">Repeat deliveries</dt><dd className="text-lg font-semibold num">{stats.orders}</dd></div>
          <div><dt className="hint">Repeat sales</dt><dd className="text-lg font-semibold num">{money(stats.salesMinor)}</dd></div>
        </dl>
        <div className="flex flex-wrap items-center gap-3">
          <form action="/admin/subscriptions" className="flex gap-2 flex-1 min-w-60" role="search">
            {status && <input type="hidden" name="show" value={status} />}
            <label htmlFor="sub-q" className="sr-only">Search subscribers</label>
            <input id="sub-q" name="q" type="search" defaultValue={q} placeholder="Subscriber's email" className="input flex-1" />
            <button className="btn btn-secondary">Search</button>
          </form>
          <nav className="flex flex-wrap gap-1 text-sm" aria-label="Subscription filter">
            {FILTERS.map((f) => (
              <Link key={f.label} href={href({ show: f.key ?? null, page: 1 })} aria-current={f.key === status ? "page" : undefined}
                className={`px-2 py-1 rounded-md ${f.key === status ? "bg-sunken font-semibold" : "hint"}`}>
                {f.label}{f.key === "failing" && failing > 0 && <span className="ml-1 pill pill-critical num">{failing}</span>}
              </Link>
            ))}
          </nav>
        </div>
        {q && (
          <p className="hint text-sm">
            {total} {total === 1 ? "subscription matches" : "subscriptions match"} &ldquo;{q}&rdquo;. <Link href={`/admin/subscriptions${status ? `?show=${status}` : ""}`} className="underline">Clear</Link>
          </p>
        )}
        {subs.length ? (
          <ul className="card divide-y divide-border" aria-label="Subscriptions">
            {subs.map((s) => {
              const label = `${s.email}${s.firstOrderNumber ? ` (order #${s.firstOrderNumber})` : ""}`;
              return (
                <li key={s.id} className="p-4 flex flex-wrap items-start justify-between gap-3 text-sm" aria-label={label}>
                  <div className="flex flex-col gap-1 min-w-56">
                    <span className="font-medium">{s.email}</span>
                    <span className="hint">
                      {intervalLabel(s.intervalDays)}, {s.percentOff}% off · from order #{s.firstOrderNumber}
                      {s.status === "active" && ` · next ${formatDeliveryDate(s.nextOrderAt)}`}
                    </span>
                    {s.status === "paused" && s.pausedBy === "payment" && <span className="text-critical">Paused after failed charges: {s.lastError}</span>}
                    {s.status === "active" && s.failures > 0 && <span className="text-critical">Last try failed ({s.lastError}). Trying again {formatDeliveryDate(s.nextOrderAt)}.</span>}
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="num">{s.deliveries} {s.deliveries === 1 ? "delivery" : "deliveries"} · {money(s.salesMinor)}</span>
                    <span className={`pill ${s.status === "active" ? "pill-success" : "pill-neutral"}`}>{STATUS[s.status]}</span>
                    {s.status !== "cancelled" && <SubscriptionRowActions id={s.id} label={label} testMode={testPayments()} active={s.status === "active"} />}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="hint">{filtered ? "None here." : "No subscriptions yet. Once Subscribe and save is on, buyers see the offer on their order page right after paying."}</p>
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
