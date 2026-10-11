import Link from "next/link";
import { formatMoney, listOrders, orderTags, RISK_HOLD_LABELS } from "@sf/core";
import { requireShop } from "@/lib/server";
import { FulfilmentStatus, PaymentStatus } from "@/components/Status";
import { PageHeader } from "../PageHeader";
import { RiskHoldForm } from "./RiskHoldForm";

export const metadata = { title: "Orders" };

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ show?: string; q?: string; tag?: string }> }) {
  const { show, q, tag } = await searchParams;
  const problemsOnly = show === "problems";
  const heldOnly = show === "held";
  const { shop, db } = await requireShop("orders");
  const [orders, problems, held, tags] = await Promise.all([
    listOrders(db, shop.id, { ...(problemsOnly ? { fulfillmentStatus: "problem" as const } : heldOnly ? { held: true } : {}), query: q, tag }),
    listOrders(db, shop.id, { fulfillmentStatus: "problem" }),
    listOrders(db, shop.id, { held: true }),
    orderTags(db, shop.id),
  ]);
  const heldIds = new Set(held.map((o) => o.id));
  const filtered = !!(q || tag);
  // Keeps the other filters when one changes.
  const href = (next: { show?: string; q?: string; tag?: string }) => {
    const params = new URLSearchParams(Object.entries({ show, q, tag, ...next }).filter((e): e is [string, string] => !!e[1]));
    return params.size ? `/admin/orders?${params}` : "/admin/orders";
  };
  return (
    <main className="pb-12">
      <PageHeader title="Orders" actions={<Link href="/admin/orders/new" className="btn btn-secondary">Create payment link</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-4">
        <nav className="flex gap-1" aria-label="Order filters">
          <Link href={href({ show: undefined })} className={`chip text-sm ${!problemsOnly && !heldOnly ? "font-semibold border-accent" : ""}`} aria-current={!problemsOnly && !heldOnly ? "page" : undefined}>All</Link>
          <Link href={href({ show: "problems" })} className={`chip text-sm ${problemsOnly ? "font-semibold border-accent" : ""}`} aria-current={problemsOnly ? "page" : undefined}>
            Needs attention {problems.length > 0 && <span className="pill pill-critical">{problems.length}</span>}
          </Link>
          <Link href={href({ show: "held" })} className={`chip text-sm ${heldOnly ? "font-semibold border-accent" : ""}`} aria-current={heldOnly ? "page" : undefined}>
            On hold {held.length > 0 && <span className="pill pill-warning">{held.length}</span>}
          </Link>
        </nav>
        <form className="flex gap-2 max-w-md" role="search">
          <label className="sr-only" htmlFor="q">Search orders</label>
          <input className="input" id="q" name="q" type="search" defaultValue={q} placeholder="Order number, name or email" />
          {show && <input type="hidden" name="show" value={show} />}
          {tag && <input type="hidden" name="tag" value={tag} />}
          <button className="btn btn-secondary">Search</button>
        </form>
        {tags.length > 0 && (
          <nav aria-label="Filter by tag" className="flex flex-wrap gap-2 text-sm">
            <Link href={href({ tag: undefined })} className={`pill ${tag ? "pill-neutral" : "pill-info"}`} aria-current={tag ? undefined : "page"}>All tags</Link>
            {tags.map((t) => (
              <Link key={t.tag} href={href({ tag: t.tag })} className={`pill ${tag === t.tag ? "pill-info" : "pill-neutral"}`} aria-current={tag === t.tag ? "page" : undefined}>
                {t.tag} <span className="hint num">{t.count}</span>
              </Link>
            ))}
          </nav>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer underline w-fit">Download as a spreadsheet</summary>
          <form method="get" action="/admin/orders/export.csv" className="flex flex-wrap items-end gap-3 mt-3" aria-label="Download orders">
            <div className="field">
              <label className="label" htmlFor="export-from">From</label>
              <input className="input" id="export-from" name="from" type="date" />
            </div>
            <div className="field">
              <label className="label" htmlFor="export-to">To</label>
              <input className="input" id="export-to" name="to" type="date" />
            </div>
            {show && <input type="hidden" name="show" value={show} />}
            {q && <input type="hidden" name="q" value={q} />}
            {tag && <input type="hidden" name="tag" value={tag} />}
            <button className="btn btn-secondary">Download CSV</button>
            <p className="hint w-full">One row per item, with the orders shown above{filtered || show ? " (your filters apply)" : ""}. Leave the dates empty for all of them.</p>
          </form>
        </details>
        {heldOnly && (
          <section className="card p-5 flex flex-col gap-3" aria-labelledby="risk-settings">
            <h2 id="risk-settings" className="font-semibold">Risk check</h2>
            <p className="text-sm hint max-w-2xl">Every paid order is checked for signs of a stolen card, like a throwaway email, several declined cards or an address many buyers ship to. A held order waits for you before it goes to the supplier, so you can refund it before you&apos;ve paid for the goods.</p>
            <RiskHoldForm value={shop.holdRiskyOrders} options={Object.entries(RISK_HOLD_LABELS)} />
          </section>
        )}
        {filtered && orders.length === 0 ? (
          <div className="card p-10 text-center hint">{q ? `No orders match "${q}".` : `No orders are tagged "${tag}".`}</div>
        ) : heldOnly && orders.length === 0 ? (
          <div className="card p-10 text-center hint">No orders on hold.</div>
        ) : problemsOnly && orders.length === 0 ? (
          <div className="card p-10 text-center hint">No problem orders. Anything a supplier refuses or doesn't ship on time shows up here.</div>
        ) : orders.length === 0 ? (
          <div className="card p-10 flex flex-col items-center text-center gap-3">
            <h2 className="font-semibold text-lg">No orders yet</h2>
            <p className="hint max-w-sm">When a buyer checks out, the order shows up here with its payment and delivery status.</p>
            <a href={`/s/${shop.handle}`} target="_blank" className="btn btn-secondary">Visit your store ↗</a>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table min-w-[680px]">
              <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Payment</th><th>Delivery</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-sunken">
                    <td><Link href={`/admin/orders/${o.id}`} className="font-semibold num">#{o.number}</Link></td>
                    <td className="hint num">{dateFmt.format(o.createdAt)}</td>
                    <td className="max-w-[240px]">
                      <span className="block truncate">{o.shippingAddress.name}</span>
                      {(o.tags.length > 0 || o.buyerNote) && (
                        <span className="flex flex-wrap gap-1 mt-1">
                          {o.buyerNote && <span className="pill pill-info text-xs" title={o.buyerNote}>Has a note</span>}
                          {o.tags.map((t) => <span key={t} className="pill pill-neutral text-xs">{t}</span>)}
                        </span>
                      )}
                    </td>
                    <td><PaymentStatus value={o.paymentStatus} /></td>
                    <td>{heldIds.has(o.id) ? <span className="pill pill-warning">On hold</span> : <FulfilmentStatus value={o.fulfillmentStatus} />}</td>
                    <td className="text-right num">{formatMoney(o.totalMinor, o.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
