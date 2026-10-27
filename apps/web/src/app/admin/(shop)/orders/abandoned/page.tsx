import Link from "next/link";
import { ABANDONED_DAYS, abandonedCheckouts, formatMoney } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../../PageHeader";

export const metadata = { title: "Abandoned checkouts" };

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Buyers who started checking out and didn't pay: what they left, whether they were reminded, and who came back. */
export default async function AbandonedCheckoutsPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { before: beforeParam } = await searchParams;
  const before = /^\d{1,9}$/.test(beforeParam ?? "") ? Number(beforeParam) : undefined;
  const { shop, db } = await requireShop("orders");
  const { checkouts, older, totals } = await abandonedCheckouts(db, shop.id, { before });
  return (
    <main className="pb-12">
      <PageHeader title="Abandoned checkouts" back={<Link href="/admin/orders" className="hint hover:text-ink">← Orders</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-4">
        <p className="hint max-w-2xl">
          Buyers who got as far as checkout in the last {ABANDONED_DAYS} days and didn&apos;t pay: an hour or more ago, or sooner once they were sent a reminder.{" "}
          {shop.abandonedCartEmails
            ? "Each one gets a reminder email with a link back to their cart."
            : <>Reminder emails are off, so nobody is reminded. <Link href="/admin/marketing" className="underline">Turn them on under Marketing</Link>.</>}
        </p>
        {totals.count > 0 && (
          <dl className="grid grid-cols-3 gap-3 max-w-xl">
            <div className="card p-3"><dt className="hint text-xs">Left unpaid</dt><dd className="font-semibold num">{totals.count}</dd></div>
            <div className="card p-3"><dt className="hint text-xs">Worth</dt><dd className="font-semibold num">{formatMoney(totals.valueMinor, shop.currency)}</dd></div>
            <div className="card p-3"><dt className="hint text-xs">Came back and paid</dt><dd className="font-semibold num">{totals.recovered}</dd></div>
          </dl>
        )}
        {checkouts.length === 0 ? (
          <div className="card p-10 text-center hint">
            {before ? <>No older checkouts. <Link href="/admin/orders/abandoned" className="underline">Back to the newest</Link></> : "No abandoned checkouts. When a buyer leaves at checkout, it shows up here an hour later."}
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table min-w-[640px]">
              <thead><tr><th>Checkout</th><th>Started</th><th>Buyer</th><th className="text-right">Items</th><th className="text-right">Total</th><th>Reminder</th><th>Came back</th></tr></thead>
              <tbody>
                {checkouts.map((c) => (
                  <tr key={c.id} className="hover:bg-sunken">
                    <td><Link href={`/admin/orders/${c.id}`} className="font-semibold num">#{c.number}</Link></td>
                    <td className="hint num">{dateFmt.format(c.createdAt)}</td>
                    <td className="max-w-[220px]"><span className="block truncate">{c.name}</span><span className="block truncate hint text-xs">{c.email}</span></td>
                    <td className="text-right num">{c.items}</td>
                    <td className="text-right num">{formatMoney(c.totalMinor, c.currency)}</td>
                    <td>{c.offered ? <span className="pill pill-info">Sent, with a code</span> : c.reminded ? <span className="pill pill-info">Sent</span> : <span className="pill pill-neutral">Not sent</span>}</td>
                    <td>{c.recoveredBy === null ? <span className="hint">Not yet</span> : c.recoveredBy === c.number ? <span className="pill pill-success">Paid</span> : <span className="pill pill-success">Paid as #{c.recoveredBy}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(before || older) && checkouts.length > 0 && (
          <nav aria-label="Pages" className="flex items-center gap-3 text-sm">
            {before && <Link href="/admin/orders/abandoned" className="btn btn-secondary">← Newest</Link>}
            {older && <Link href={`/admin/orders/abandoned?before=${older}`} className="btn btn-secondary ml-auto">Older →</Link>}
          </nav>
        )}
      </div>
    </main>
  );
}
