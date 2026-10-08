import Link from "next/link";
import { notFound } from "next/navigation";
import { getShopForStaff, listNotices, NOTICE_REASONS, storeHealth } from "@sf/core";
import { requireStaff, storeUrl } from "@/lib/server";
import { SendNoticeForm } from "../../StaffForms";

const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const pct = (r: number | null) => (r === null ? "n/a" : `${Math.round(r * 100)}%`);

export default async function StaffStore({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await requireStaff();
  const shop = await getShopForStaff(db, id);
  if (!shop) notFound();
  const [notices, health] = await Promise.all([listNotices(db, shop.id), storeHealth(db, shop.id)]);
  return (
    <main className="px-4 sm:px-8 py-6 flex flex-col gap-6 max-w-3xl">
      <Link href="/staff" className="hint">← All stores</Link>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight">{shop.name}</h1>
        <span className="pill pill-neutral">{shop.status}</span>
        <a className="hint underline" href={storeUrl(shop.handle)} target="_blank">Open store ↗</a>
      </div>
      <section className="card p-5 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div><p className="hint">Paid orders (90 days)</p><p className="text-xl font-semibold num">{health.paidOrders}</p></div>
        <div><p className="hint">Shipped on time</p><p className="text-xl font-semibold num">{pct(health.onTimeRate)}</p></div>
        <div><p className="hint">Refund rate</p><p className="text-xl font-semibold num">{pct(health.refundRate)}</p></div>
        <div><p className="hint">Payouts</p><p className="text-xl font-semibold">{shop.payoutsEnabled ? "On" : "Off"}</p></div>
      </section>
      <section className="card p-5 flex flex-col gap-4">
        <h2 className="font-semibold">Send a notice</h2>
        <p className="hint">Warn first. Pausing needs an earlier warning for the same reason, except for illegal products and identity.</p>
        <SendNoticeForm shopId={shop.id} reasons={Object.entries(NOTICE_REASONS).map(([value, r]) => ({ value, title: r.title }))} />
      </section>
      <section className="card p-5 flex flex-col gap-3">
        <h2 className="font-semibold">Notices</h2>
        {notices.length === 0 && <p className="hint">None.</p>}
        {notices.map((n) => (
          <div key={n.id} className="text-sm border-l-2 border-border pl-3 flex flex-col gap-1">
            <p><span className="font-semibold">{n.kind}</span> · {n.title} · <span className="hint">{day.format(n.createdAt)} by {n.createdBy}{n.closedAt ? " · closed" : ""}</span></p>
            <p>{n.explanation}</p>
            {n.appeals.map((a) => <p key={a.id} className="hint">Appeal ({a.status}): {a.message}{a.response ? `. Our reply: ${a.response}` : ""}</p>)}
          </div>
        ))}
      </section>
    </main>
  );
}
