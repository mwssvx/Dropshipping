import { formatMoney, listTaxRegistrations, TAX_JURISDICTIONS, taxReport } from "@sf/core";
import { requireShop, tax } from "@/lib/server";
import { removeTaxRegistrationAction, setPricesIncludeTaxAction } from "../../money-actions";
import { PageHeader } from "../PageHeader";
import { AddRegistrationForm } from "./TaxForms";

export const metadata = { title: "Taxes" };

function quarter(offset: number) {
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3) + offset;
  const from = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), q * 3 + 3, 1) - 1);
  return { from, to, label: `Q${((q % 4) + 4) % 4 + 1} ${from.getUTCFullYear()}` };
}

export default async function TaxesPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { shop, db } = await requireShop();
  const { period } = await searchParams;
  const range = quarter(period === "last" ? -1 : 0);
  const [registrations, report] = await Promise.all([listTaxRegistrations(db, shop.id), taxReport(db, shop.id, range)]);
  const money = (m: number) => formatMoney(m, shop.currency);
  const name = (code: string) => TAX_JURISDICTIONS.find((j) => j.code === code)?.name ?? code;
  const taken = new Set(registrations.map((r) => r.jurisdiction));
  const builtIn = tax().name === "builtin";

  return (
    <main className="pb-12">
      <PageHeader title="Taxes" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <section className="card p-5 flex flex-col gap-3 text-sm">
          <h2 className="font-semibold">How tax works here</h2>
          <p>
            We charge tax only to buyers in places where you've told us you're registered, at the buyer's local rate. It's added to
            the order, shown on the receipt, and listed below so you know what to pay the tax office. Our 2% fee is never taken on tax.
          </p>
          <p className="hint">
            Not sure if you need to register? Sellers outside the UK need UK VAT from their first sale there. In the EU, one OSS or
            IOSS registration covers every country. US states require it once your sales into the state pass a threshold, often
            $100,000 a year. An accountant can confirm what applies to you.
          </p>
          {builtIn && <p className="hint">Rates are national and state rates. When Stripe Tax is switched on, US city and county rates are added too.</p>}
        </section>

        <section className="card p-5 flex flex-col gap-3">
          <h2 className="font-semibold">Your prices</h2>
          <form action={setPricesIncludeTaxAction} className="flex flex-col gap-2 text-sm">
            <label className="flex gap-2 items-start">
              <input type="radio" name="pricesIncludeTax" value="1" defaultChecked={shop.pricesIncludeTax} className="mt-1" />
              <span><span className="font-medium">Include tax</span> <span className="hint">· usual in the UK and EU. A $20 price is $20 at checkout.</span></span>
            </label>
            <label className="flex gap-2 items-start">
              <input type="radio" name="pricesIncludeTax" value="0" defaultChecked={!shop.pricesIncludeTax} className="mt-1" />
              <span><span className="font-medium">Add tax at checkout</span> <span className="hint">· usual in the US and Canada.</span></span>
            </label>
            <div><button className="btn btn-secondary">Save</button></div>
          </form>
        </section>

        <section className="card p-5 flex flex-col gap-4">
          <h2 className="font-semibold">Where you collect tax</h2>
          {registrations.length ? (
            <ul className="divide-y divide-border border-y border-border">
              {registrations.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span>{name(r.jurisdiction)}{r.registrationNumber && <span className="hint num"> · {r.registrationNumber}</span>}</span>
                  <form action={removeTaxRegistrationAction.bind(null, r.id)}><button className="hint hover:text-critical">Remove</button></form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint text-sm">None yet, so no tax is charged on any order.</p>
          )}
          <AddRegistrationForm options={TAX_JURISDICTIONS.filter((j) => !taken.has(j.code))} />
        </section>

        <section className="card">
          <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2 flex-wrap">
            <h2 className="font-semibold">Tax collected, {range.label}</h2>
            <nav className="flex gap-3 text-sm" aria-label="Period">
              <a href="/admin/taxes" aria-current={period !== "last" ? "page" : undefined} className="hint aria-[current=page]:text-ink aria-[current=page]:font-semibold">This quarter</a>
              <a href="/admin/taxes?period=last" aria-current={period === "last" ? "page" : undefined} className="hint aria-[current=page]:text-ink aria-[current=page]:font-semibold">Last quarter</a>
            </nav>
          </div>
          {report.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left hint">
                  <th className="px-5 py-2 font-medium">Place</th>
                  <th className="px-5 py-2 font-medium text-right">Orders</th>
                  <th className="px-5 py-2 font-medium text-right">Sales before tax</th>
                  <th className="px-5 py-2 font-medium text-right">Tax to pay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border num">
                {report.map((r) => (
                  <tr key={r.jurisdiction}>
                    <td className="px-5 py-3 font-sans">{r.label.replace(/ [\d.]+%$/, "")} <span className="hint">{r.jurisdiction}</span></td>
                    <td className="px-5 py-3 text-right">{r.orders}</td>
                    <td className="px-5 py-3 text-right">{money(r.salesMinor)}</td>
                    <td className="px-5 py-3 text-right font-semibold">{money(r.taxMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="hint px-5 pb-4 text-sm">No tax collected in this period.</p>
          )}
          <p className="hint px-5 pb-4 text-xs">After refunds. Your Money statement lists the tax on every order.</p>
        </section>
      </div>
    </main>
  );
}
