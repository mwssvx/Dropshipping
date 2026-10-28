import { bundleProductChoices, formatMoney, listCollections, listSales, MAX_SALES, saleResults, type SaleOutcome } from "@sf/core";
import { requireShop } from "@/lib/server";
import { deleteSaleAction, endSaleAction } from "../../sale-actions";
import { PageHeader } from "../PageHeader";
import { SaleForm } from "./SaleForm";
import { LowestPriceForm } from "./LowestPriceForm";

export const metadata = { title: "Sales" };

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
const STATUS = { running: { label: "On now", pill: "pill-success" }, scheduled: { label: "Scheduled", pill: "pill-info" }, ended: { label: "Ended", pill: "pill-neutral" } } as const;

export default async function SalesPage() {
  const { shop, db } = await requireShop("marketing");
  const [sales, products, collections] = await Promise.all([listSales(db, shop.id), bundleProductChoices(db, shop.id), listCollections(db, shop.id)]);
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
