import Link from "next/link";
import { formatDeliveryDate, formatMoney, intervalLabel, listSubscriptions, subscriptionStats } from "@sf/core";
import { requireShop, testPayments } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { SubscriptionRowActions } from "./SubscriptionRowActions";

export const metadata = { title: "Subscriptions" };

const STATUS = { active: "Active", paused: "Paused", cancelled: "Cancelled" } as const;

export default async function SubscriptionsPage() {
  const { shop, db } = await requireShop("orders");
  const [subs, stats] = await Promise.all([listSubscriptions(db, shop.id), subscriptionStats(db, shop.id)]);
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
          <p className="hint">No subscriptions yet. Once Subscribe and save is on, buyers see the offer on their order page right after paying.</p>
        )}
      </div>
    </main>
  );
}
