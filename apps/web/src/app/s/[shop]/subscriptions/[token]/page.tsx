import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDeliveryDate, formatMoney, getSubscriptionByToken, intervalLabel, NotFoundError, SUBSCRIPTION_INTERVALS } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../../data";
import { SubscriptionControls } from "./SubscriptionControls";

export const metadata = { title: "Your subscription", robots: { index: false } };
export const dynamic = "force-dynamic";

const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const STATUS = { active: "Active", paused: "Paused", cancelled: "Cancelled" } as const;

/** The buyer's private page for a subscription, linked from every subscription email. */
export default async function SubscriptionPage({ params }: { params: Promise<{ shop: string; token: string }> }) {
  const { shop: handle, token } = await params;
  const shop = await loadShop(handle);
  const sub = await getSubscriptionByToken(await db(), shop, token).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const base = await storeBase(handle);
  const money = (m: number) => formatMoney(m, shop.currency);
  const a = sub.shippingAddress;
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="hint">Subscribe and save · {shop.name}</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Your subscription</h1>
          <span className={`pill ${sub.status === "active" ? "pill-success" : "pill-neutral"}`}>{STATUS[sub.status]}</span>
        </div>
        <p className="text-muted">
          {intervalLabel(sub.intervalDays)}, {sub.percentOff}% off the price at the time, charged to the card from{" "}
          <Link href={`${base}/orders/${sub.firstOrder.paymentIntentId}`} className="underline">order #{sub.firstOrder.number}</Link>.
        </p>
      </div>
      {sub.status === "active" && (
        <p className="banner banner-info">Next delivery: <strong>{formatDeliveryDate(sub.nextOrderAt)}</strong>. We&apos;ll email you 3 days before.</p>
      )}
      {sub.status === "paused" && (
        <p className="banner banner-warning">
          {sub.pausedBy === "payment"
            ? `We couldn't send your last delivery: ${sub.lastError} Nothing was charged. Resume to try again.`
            : "Paused. Nothing will be sent or charged until you resume."}
        </p>
      )}
      <section className="card p-5 flex flex-col gap-3" aria-labelledby="items-heading">
        <h2 id="items-heading" className="font-semibold">Each delivery</h2>
        <ul className="text-sm flex flex-col gap-2">
          {sub.items.map((i) => (
            <li key={i.variantId} className="flex justify-between gap-3">
              <span>{i.quantity > 1 ? `${i.quantity} × ` : ""}{i.title}{!i.available && <span className="hint"> · not sold right now</span>}</span>
              {i.available && <span className="num"><s className="hint mr-2">{money(i.priceMinor)}</s>{money(i.offerMinor)}</span>}
            </li>
          ))}
        </ul>
        <p className="hint text-sm">Plus shipping and any tax, as at checkout. Goes to {a.name}, {a.line1}, {a.city}.</p>
      </section>
      {sub.status !== "cancelled" ? (
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="change-heading">
          <h2 id="change-heading" className="font-semibold">Change it</h2>
          <SubscriptionControls handle={handle} token={token} status={sub.status} intervalDays={sub.intervalDays}
            intervals={SUBSCRIPTION_INTERVALS.map((i) => ({ days: i.days, label: i.label }))} />
        </section>
      ) : (
        <p className="banner banner-info">This subscription was cancelled{sub.cancelledAt ? ` on ${date.format(sub.cancelledAt)}` : ""}. You won&apos;t be charged again.</p>
      )}
      <section className="flex flex-col gap-3" aria-labelledby="past-heading">
        <h2 id="past-heading" className="font-semibold">Deliveries so far</h2>
        {sub.orders.length ? (
          <ul className="card divide-y divide-border text-sm">
            {sub.orders.map((o) => (
              <li key={o.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                <span className="num">Order #{o.number} <span className="hint">· {date.format(o.createdAt)}</span></span>
                <span className="flex items-center gap-3">
                  <span className="num">{formatMoney(o.totalMinor, o.currency)}</span>
                  <Link href={`${base}/orders/${o.paymentIntentId}`} className="underline">Track</Link>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">None yet. The first one comes on the date above.</p>
        )}
      </section>
    </main>
  );
}
