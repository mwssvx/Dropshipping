import Link from "next/link";
import { countReturns, DEFAULT_RETURN_INSTRUCTIONS, formatMoney, listReturns, RETURN_PAGE_SIZE, RETURN_REASON_LABELS } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { DecideForm, ReturnSettingsForm } from "./ReturnForms";

export const metadata = { title: "Returns" };

const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const STATUS = {
  requested: ["Asked", "pill-warning"],
  approved: ["Approved, not refunded", "pill-info"],
  refunded: ["Refunded", "pill-success"],
  credited: ["Store credit", "pill-success"],
  replaced: ["Replacement sent", "pill-success"],
  exchanged: ["Exchange sent", "pill-success"],
  declined: ["Declined", "pill-neutral"],
} as const;

export default async function ReturnsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { shop, db } = await requireShop("returns");
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 100) || undefined;
  const page = /^\d{1,5}$/.test(params.page ?? "") ? Math.max(1, Number(params.page)) : 1;
  const [open, closed, closedTotal] = await Promise.all([
    listReturns(db, shop.id, "open"),
    listReturns(db, shop.id, "answered", { query: q, page }),
    countReturns(db, shop.id, "answered", q),
  ]);
  const pages = Math.max(1, Math.ceil(closedTotal / RETURN_PAGE_SIZE));
  const href = (p: number) => `/admin/returns?${new URLSearchParams({ ...(q ? { q } : {}), ...(p > 1 ? { page: String(p) } : {}) })}#closed-returns`;
  const orders = open.length
    ? await db.query.orders.findMany({ where: (o, { inArray }) => inArray(o.id, open.map((r) => r.orderId)), columns: { id: true, totalMinor: true, refundedMinor: true } })
    : [];
  const decimal = (m: number) => (m / 100).toFixed(2);
  return (
    <main className="pb-12">
      <PageHeader title="Returns" />
      <div className="px-4 sm:px-8 flex flex-col gap-4 max-w-3xl">
        <p className="hint">
          Buyers ask from their order page, say what and why, and get an email each time you answer. Refunds go back to how they paid;
          store credit is a gift card they can spend here. Neither costs anything extra on any plan.
        </p>
        <section className="flex flex-col gap-3" aria-labelledby="open-returns">
          <h2 id="open-returns" className="font-semibold">Waiting on you</h2>
          {open.length === 0 ? (
            <p className="hint">No returns to answer.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {open.map((r) => {
                const o = orders.find((x) => x.id === r.orderId);
                const left = o ? o.totalMinor - o.refundedMinor : r.suggestedMinor;
                return (
                  <li key={r.id} className="card p-5 flex flex-col gap-3" aria-label={`Return for order #${r.orderNumber}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">
                        <Link href={`/admin/orders/${r.orderId}`} className="underline">Order #{r.orderNumber}</Link>
                        <span className={`ml-2 pill ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
                      </span>
                      <span className="text-sm hint">{r.email} · {date.format(r.createdAt)}</span>
                    </div>
                    <div className="text-sm flex flex-col gap-1">
                      <p><span className="hint">Items:</span> {r.items.map((i) => `${i.title} × ${i.quantity}`).join(", ")}</p>
                      {r.items.some((i) => i.exchangeTitle) && (
                        <p><span className="hint">Wants instead:</span> {r.items.filter((i) => i.exchangeTitle).map((i) => `${i.exchangeTitle} × ${i.quantity}`).join(", ")}</p>
                      )}
                      <p><span className="hint">Why:</span> {RETURN_REASON_LABELS[r.reason]}</p>
                      {r.note && <p className="border-l-2 border-border pl-3 whitespace-pre-line">{r.note}</p>}
                      <p className="hint num">They paid {formatMoney(r.suggestedMinor, r.currency)} for these items.</p>
                      {r.status === "approved" && r.merchantMessage && <p className="hint">You told them: {r.merchantMessage}</p>}
                    </div>
                    <DecideForm id={r.id} approved={r.status === "approved"} exchange={r.items.some((i) => i.exchangeVariantId)} amount={decimal(Math.min(r.suggestedMinor, left))} max={formatMoney(left, r.currency)} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="return-settings">
          <h2 id="return-settings" className="font-semibold">Return policy</h2>
          <ReturnSettingsForm windowDays={shop.returnWindowDays} instructions={shop.returnInstructions ?? ""} placeholder={DEFAULT_RETURN_INSTRUCTIONS} />
        </section>
        {(closedTotal > 0 || q) && (
          <section className="flex flex-col gap-3" aria-labelledby="closed-returns">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="closed-returns" className="font-semibold">Answered</h2>
              <form action="/admin/returns#closed-returns" className="flex gap-2 min-w-60" role="search">
                <label htmlFor="return-q" className="sr-only">Search answered returns</label>
                <input id="return-q" name="q" type="search" defaultValue={q} placeholder="Order # or buyer's email" className="input flex-1" />
                <button className="btn btn-secondary">Search</button>
              </form>
            </div>
            {q && (
              <p className="hint text-sm">
                {closedTotal} {closedTotal === 1 ? "return matches" : "returns match"} &ldquo;{q}&rdquo;. <Link href="/admin/returns#closed-returns" className="underline">Clear</Link>
              </p>
            )}
            {closed.length > 0 && (
            <ul className="card divide-y divide-border">
              {closed.map((r) => (
                <li key={r.id} className="p-4 flex flex-wrap items-center justify-between gap-2 text-sm" aria-label={`Answered return for order #${r.orderNumber}`}>
                  <span>
                    <Link href={`/admin/orders/${r.orderId}`} className="underline">#{r.orderNumber}</Link> · {r.items.map((i) => `${i.title} × ${i.quantity}`).join(", ")}
                  </span>
                  <span className="flex items-center gap-2">
                    {r.resolvedMinor ? <span className="num">{formatMoney(r.resolvedMinor, r.currency)}</span> : null}
                    {r.replacementOrderId && <Link href={`/admin/orders/${r.replacementOrderId}`} className="underline">{r.status === "exchanged" ? "Exchange" : "Replacement"}</Link>}
                    <span className={`pill ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
                    {r.resolvedAt && <span className="hint">{date.format(r.resolvedAt)}</span>}
                  </span>
                </li>
              ))}
            </ul>
            )}
            {pages > 1 && (
              <nav aria-label="Pages" className="flex items-center gap-3 text-sm">
                {page > 1 && <Link href={href(page - 1)} className="btn btn-secondary">← Newer</Link>}
                <span className="hint num">Page {Math.min(page, pages)} of {pages}</span>
                {page < pages && <Link href={href(page + 1)} className="btn btn-secondary ml-auto">Older →</Link>}
              </nav>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
