import Link from "next/link";
import { bundleProductChoices, EARLY_ACCESS_HOURS, formatMoney, listCollections, listSales, MAX_SALES, saleResults, type SaleOutcome } from "@sf/core";
import { requireShop, storeAddress } from "@/lib/server";
import { deleteSaleAction, endEarlyAccessAction, endSaleAction, giveEarlyAccessAction } from "../../sale-actions";
import { PageHeader } from "../PageHeader";
import { SaleForm } from "./SaleForm";
import { LowestPriceForm } from "./LowestPriceForm";

export const metadata = { title: "Sales" };

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
const STATUS = { running: { label: "On now", pill: "pill-success" }, scheduled: { label: "Scheduled", pill: "pill-info" }, ended: { label: "Ended", pill: "pill-neutral" } } as const;

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { shop, db } = await requireShop("marketing");
  const { error } = await searchParams;
  const [sales, products, collections, store] = await Promise.all([listSales(db, shop.id), bundleProductChoices(db, shop.id), listCollections(db, shop.id), storeAddress(shop)]);
  const results = await saleResults(db, shop.id, sales);
  return (
    <main className="pb-12">
      <PageHeader title="Sales" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-4xl">
        <p className="hint max-w-2xl">
          Take a percentage off everything, one collection or chosen products, between two times. The store shows the old price crossed out while
          it runs, and it ends by itself. Buyers who saved a product get an email when its sale starts. Quantity, bundle and wholesale discounts come
          off the sale price; if sales overlap, a product gets the biggest one.
        </p>
        {error && <p role="alert" className="banner banner-critical">{error}</p>}
        <section className="card p-5 flex flex-col gap-4" aria-labelledby="new-heading">
          <h2 id="new-heading" className="font-semibold">New sale</h2>
          {products.length === 0 ? <p className="hint">Add a product first.</p> : <SaleForm products={products} collections={collections.map((c) => ({ id: c.id, title: c.title }))} />}
        </section>
        <section className="flex flex-col gap-3" aria-labelledby="list-heading">
          <div className="flex justify-between items-baseline gap-3">
            <h2 id="list-heading" className="font-semibold">Your sales</h2>
            <span className="hint num">{sales.length} of {MAX_SALES}</span>
          </div>
          {sales.length === 0 && <p className="hint">None yet.</p>}
          <ul className="flex flex-col gap-3">
            {sales.map((s) => (
              <li key={s.id} className="card p-4 flex flex-wrap items-center gap-3" aria-label={s.title}>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{s.title} <span className="hint">· {s.percentOff}% off</span></p>
                  <p className="hint text-sm">{s.covers} · {s.endsAt ? `${when.format(s.startsAt)} to ${when.format(s.endsAt)}` : `From ${when.format(s.startsAt)}, until you end it`}{s.countdown ? " · counts down on the store" : ""}</p>
                  {results.has(s.id) && <SaleResult title={s.title} running={s.status === "running"} result={results.get(s.id)!} currency={shop.currency} />}
                </div>
                <span className={`pill ${STATUS[s.status].pill}`}>{STATUS[s.status].label}</span>
                {s.status === "running" ? (
                  <form action={endSaleAction.bind(null, s.id)}>
                    <button className="btn btn-secondary btn-sm">End now</button>
                  </form>
                ) : (
                  <form action={deleteSaleAction.bind(null, s.id)}>
                    <button className="hint hover:text-critical text-sm" aria-label={`Delete ${s.title}`}>Delete</button>
                  </form>
                )}
                {s.status === "scheduled" && <EarlyAccess sale={s} store={store} />}
              </li>
            ))}
          </ul>
        </section>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="lowest-heading">
          <div>
            <h2 id="lowest-heading" className="font-semibold">Lowest earlier price</h2>
            <p className="hint">
              In the EU, a reduced price has to show the lowest price the product had in the 30 days before the discount. Your store works it out from
              every price each option has had, including earlier sales, and shows it under any crossed-out price. Until it has 30 days of history for a
              product, it says nothing rather than guess.
            </p>
          </div>
          <LowestPriceForm value={shop.lowestPriceNote} />
        </section>
      </div>
    </main>
  );
}

const BEFORE: Record<(typeof EARLY_ACCESS_HOURS)[number], string> = { 0: "From now", 24: "1 day before", 48: "2 days before", 72: "3 days before" };

/** A scheduled sale's early access: its code and link once made, or the form to make it. */
function EarlyAccess({ sale: s, store }: { sale: Awaited<ReturnType<typeof listSales>>[number]; store: string }) {
  if (s.early) {
    return (
      <div className="basis-full flex flex-col gap-2 border-t border-border pt-3" aria-label={`Early access to ${s.title}`}>
        <p className="text-sm">
          <span className="font-medium">Early access</span> with the code <span className="font-mono">{s.early.code}</span>
          {s.early.startsAt && s.early.startsAt > new Date() ? `, from ${when.format(s.early.startsAt)}` : ""} until the sale starts
          {s.early.customerTag ? `, only for customers tagged “${s.early.customerTag}”` : ", for anyone with the link"}.
        </p>
        <div className="field">
          <label className="label" htmlFor={`early-${s.id}`}>Link to send (applies the code)</label>
          <input className="input font-mono text-xs" id={`early-${s.id}`} readOnly value={`${store}/discount/${s.early.code}`} />
        </div>
        <div className="flex flex-wrap gap-3 items-center text-sm">
          <Link href={`/admin/campaigns/new?early=${s.id}`} className="btn btn-secondary btn-sm">{s.early.customerTag ? `Email the “${s.early.customerTag}” customers` : "Email your subscribers"}</Link>
          <form action={endEarlyAccessAction.bind(null, s.id)}>
            <button className="hint hover:text-critical">Stop early access</button>
          </form>
        </div>
      </div>
    );
  }
  return (
    <form action={giveEarlyAccessAction.bind(null, s.id)} className="basis-full flex flex-wrap items-end gap-3 border-t border-border pt-3" aria-label={`Early access to ${s.title}`}>
      <p className="hint text-sm basis-full">Let subscribers or your best customers in first: a code with the same {s.percentOff}% off that stops when the sale starts.</p>
      <div className="field">
        <label className="label" htmlFor={`hours-${s.id}`}>Early access from</label>
        <select className="input" id={`hours-${s.id}`} name="hours" defaultValue="0">
          {EARLY_ACCESS_HOURS.map((h) => <option key={h} value={h}>{BEFORE[h]}</option>)}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor={`tag-${s.id}`}>Only customers tagged (optional)</label>
        <input className="input" id={`tag-${s.id}`} name="tag" placeholder="vip" maxLength={30} />
      </div>
      <button className="btn btn-secondary btn-sm">Give early access</button>
    </form>
  );
}

const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);

/** "Over 3 days: 42 orders, 61 items on sale, $1,830.00 · 3.2× the 3 days before". */
function SaleResult({ title, running, result: r, currency }: { title: string; running: boolean; result: SaleOutcome; currency: string }) {
  const up = r.lift !== null && r.lift >= 1.05;
  const down = r.lift !== null && r.lift <= 0.95;
  const vs = r.lift === null ? null : up ? `${r.lift.toFixed(1)}× the ${days(r.days)} before` : down ? `Down ${Math.round((1 - r.lift) * 100)}% on the ${days(r.days)} before` : `About the same as the ${days(r.days)} before`;
  return (
    <p className="text-sm num mt-1" aria-label={`Results of ${title}`}>
      {running ? `${days(r.days)} so far` : `Over ${days(r.days)}`}: {r.orders === 1 ? "1 order" : `${r.orders} orders`}, {r.units === 1 ? "1 item" : `${r.units} items`} on sale, {formatMoney(r.salesMinor, currency)}
      {vs && <span className={up ? "text-success" : down ? "text-critical" : "hint"}> · {vs}</span>}
    </p>
  );
}
