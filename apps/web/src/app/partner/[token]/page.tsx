import { notFound } from "next/navigation";
import { formatMoney, PARTNER_HOLD_DAYS, partnerPortal } from "@sf/core";
import { BRAND } from "@/lib/brand";
import { db, storeAddress } from "@/lib/server";

export const metadata = { title: "Your earnings", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const STATUS = { earned: "Earned", pending: "Waiting to count", refunded: "Refunded" } as const;

/** A store's partner sees their code, the orders it brought and what they've earned. No account needed. */
export default async function PartnerPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const portal = await partnerPortal(await db(), token);
  if (!portal) notFound();
  const money = (m: number) => formatMoney(m, portal.shop.currency);
  const store = await storeAddress({ id: portal.shop.id, handle: portal.shop.handle });
  const t = portal.totals;
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="hint">{BRAND} · for {portal.partner.name}</p>
        <h1 className="text-3xl font-bold tracking-tight">Your earnings with {portal.shop.name}</h1>
        {portal.partner.active ? (
          <p className="text-muted">
            Buyers get {portal.percentOff}% off with your code <span className="font-mono font-semibold">{portal.code}</span>, and you get {portal.partner.rate} of
            what they pay for their items.
          </p>
        ) : (
          <p className="banner banner-warning">{portal.shop.name} has paused your code, so it doesn&apos;t work right now.</p>
        )}
      </header>
      {portal.partner.active && (
        <section className="card p-5 flex flex-col gap-2" aria-labelledby="share">
          <h2 id="share" className="font-semibold">Your link</h2>
          <p className="hint text-sm">Anyone who opens it gets your code in their cart.</p>
          <input className="input font-mono text-sm" readOnly value={`${store}/discount/${portal.code}`} aria-labelledby="share" />
        </section>
      )}
      <section className="card p-5 grid grid-cols-2 sm:grid-cols-4 gap-4" aria-label="Your numbers">
        <Stat label="Orders" value={t.orders.toLocaleString("en-US")} />
        <Stat label="Earned" value={money(t.earnedMinor)} />
        <Stat label="Waiting to count" value={money(t.pendingMinor)} />
        <Stat label="To be paid" value={money(t.owedMinor)} />
      </section>
      <p className="hint text-sm -mt-4">
        An order counts once it&apos;s delivered, or {PARTNER_HOLD_DAYS} days after it was paid. Refunds come off. Paid to you so far: {money(t.paidMinor)}.
      </p>
      <section className="flex flex-col gap-3" aria-labelledby="orders">
        <h2 id="orders" className="font-semibold">Orders with your code</h2>
        {portal.orders.length === 0 ? (
          <p className="card p-5 hint">No orders yet. Share your link to get started.</p>
        ) : (
          <table className="card w-full text-sm">
            <thead>
              <tr className="text-left hint">
                <th className="px-4 py-2 font-normal">Date</th>
                <th className="px-4 py-2 font-normal text-right">Items</th>
                <th className="px-4 py-2 font-normal text-right">Your share</th>
                <th className="px-4 py-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {portal.orders.map((o, i) => (
                <tr key={i}>
                  <td className="px-4 py-2">{date.format(o.date)}</td>
                  <td className="px-4 py-2 text-right num">{money(o.goodsMinor)}</td>
                  <td className="px-4 py-2 text-right num">{money(o.shareMinor)}</td>
                  <td className="px-4 py-2">{STATUS[o.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {portal.payouts.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="payouts">
          <h2 id="payouts" className="font-semibold">Payments to you</h2>
          <ul className="card divide-y divide-border text-sm">
            {portal.payouts.map((p, i) => (
              <li key={i} className="p-4 flex flex-wrap justify-between gap-2">
                <span>{money(p.amountMinor)}{p.note ? ` · ${p.note}` : ""}</span>
                <span className="hint">{date.format(p.paidAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="hint text-sm">{label}</span>
      <span className="text-xl font-semibold num">{value}</span>
    </div>
  );
}
