import Link from "next/link";
import { formatHandoverDay, handoverParam, handoverSchedule, handoverSheet } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PrintButton } from "@/components/PrintButton";

export const metadata = { title: "Day sheet" };

type Row = Awaited<ReturnType<typeof handoverSheet>>["pickups"][number];

function Items({ row }: { row: Row }) {
  return (
    <ul>
      {row.items.map((i, n) => (
        <li key={n}><span className="num font-semibold">{i.quantity} ×</span> {i.title}</li>
      ))}
    </ul>
  );
}

/** The day's pickups and local deliveries on one sheet to print: who, what, and where. */
export default async function DaySheetPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { day: dayParam } = await searchParams;
  const { shop, db } = await requireShop("orders");
  if (!shop.handoverDays) {
    return (
      <main className="px-4 sm:px-8 py-6 pb-12 flex flex-col gap-4 max-w-4xl">
        <Link href="/admin/orders" className="hint hover:text-ink">← Orders</Link>
        <h1 className="text-2xl font-bold tracking-tight">Day sheet</h1>
        <div className="card p-10 text-center hint">
          Buyers don&apos;t pick a day yet. Turn on <Link href="/admin/shipping#handover" className="underline">pickup and delivery days</Link> under Shipping.
        </div>
      </main>
    );
  }
  const schedule = await handoverSchedule(db, shop.id, shop.handoverDays);
  const day = handoverParam(dayParam) ?? schedule.today;
  const { pickups, deliveries } = await handoverSheet(db, shop.id, day, schedule.today);
  const isToday = day === schedule.today;
  const title = `${isToday ? "Today, " : ""}${formatHandoverDay(day)}`;
  return (
    <main className="px-4 sm:px-8 py-6 pb-12 flex flex-col gap-4 max-w-4xl">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <Link href={`/admin/orders?day=${day}`} className="hint hover:text-ink">← Orders</Link>
        {pickups.length + deliveries.length > 0 && <PrintButton>Print day sheet</PrintButton>}
      </div>
      <h1 className="text-2xl font-bold tracking-tight">Day sheet</h1>
      <nav aria-label="Days" className="flex flex-wrap gap-2 text-sm">
        {schedule.days.map((d) => (
          <Link key={d.day} href={`/admin/orders/day-sheet?day=${d.day}`} className={`chip ${d.day === day ? "font-semibold border-accent" : ""}`} aria-current={d.day === day ? "page" : undefined}>
            {d.today ? "Today" : formatHandoverDay(d.day)}
          </Link>
        ))}
      </nav>
      <p className="hint max-w-2xl">
        Everything to hand over on one page: pickups by name, so you find them on the shelf, and deliveries by postal code, in a sensible driving order.
        {isToday && " Today's sheet also lists anyone from earlier days who hasn't come yet."}
      </p>
      {pickups.length + deliveries.length === 0 ? (
        <div className="card p-10 text-center hint">Nothing to hand over on {title}.</div>
      ) : (
        <div className="print-sheets flex flex-col gap-4">
          {pickups.length > 0 && (
            <article className="card p-6 sm:p-8 flex flex-col gap-4 text-sm" aria-label="Pickups">
              <h2 className="font-semibold text-base">Pickups · {title} <span className="hint num">({pickups.length})</span></h2>
              <table className="w-full">
                <thead>
                  <tr className="text-left border-b border-border">
                    <th className="py-2 w-10" aria-label="Handed over"></th>
                    <th className="py-2">Buyer</th>
                    <th className="py-2">Order</th>
                    <th className="py-2">Items</th>
                  </tr>
                </thead>
                <tbody>
                  {pickups.map((r) => (
                    <tr key={r.id} className="border-b border-border align-top">
                      <td className="py-2"><span className="inline-block size-4 border border-ink rounded-sm" aria-hidden /></td>
                      <td className="py-2">
                        <span className="font-semibold">{r.name}</span>
                        {r.phone && <span className="block num text-muted">{r.phone}</span>}
                        {r.late && <span className="block text-critical">Due earlier</span>}
                      </td>
                      <td className="py-2 num"><Link href={`/admin/orders/${r.id}`}>#{r.number}</Link>{r.ready ? <span className="block text-muted">Ready</span> : <span className="block text-muted">Not packed yet</span>}</td>
                      <td className="py-2"><Items row={r} />{r.note && <p className="text-muted mt-1">Note: {r.note}</p>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          )}
          {deliveries.length > 0 && (
            <article className="card p-6 sm:p-8 flex flex-col gap-4 text-sm" aria-label="Deliveries">
              <h2 className="font-semibold text-base">Deliveries · {title} <span className="hint num">({deliveries.length})</span></h2>
              <table className="w-full">
                <thead>
                  <tr className="text-left border-b border-border">
                    <th className="py-2 w-10" aria-label="Delivered"></th>
                    <th className="py-2">Address</th>
                    <th className="py-2">Order</th>
                    <th className="py-2">Items</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((r) => (
                    <tr key={r.id} className="border-b border-border align-top">
                      <td className="py-2"><span className="inline-block size-4 border border-ink rounded-sm" aria-hidden /></td>
                      <td className="py-2">
                        <span className="font-semibold">{r.name}</span>
                        <span className="block">{r.address}</span>
                        {r.phone && <span className="block num text-muted">{r.phone}</span>}
                        {r.late && <span className="block text-critical">Due earlier</span>}
                      </td>
                      <td className="py-2 num"><Link href={`/admin/orders/${r.id}`}>#{r.number}</Link></td>
                      <td className="py-2"><Items row={r} />{r.note && <p className="text-muted mt-1">Note: {r.note}</p>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          )}
        </div>
      )}
    </main>
  );
}
