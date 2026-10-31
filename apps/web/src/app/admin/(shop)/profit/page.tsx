import Link from "next/link";
import { AD_CHANNEL_LABELS, formatMoney, productChoices, PROFIT_RANGES, profitReport, type ProfitRange } from "@sf/core";
import { requireShop } from "@/lib/server";
import { deleteAdSpendAction } from "../../profit-actions";
import { PageHeader } from "../PageHeader";
import { AdSpendForm } from "./AdSpendForm";

export const metadata = { title: "Profit" };

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtDay = (d: string) => day.format(new Date(`${d}T12:00:00Z`));

export default async function ProfitPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { shop, db } = await requireShop("money");
  const { days: raw } = await searchParams;
  const days = (PROFIT_RANGES.find((d) => String(d) === raw) ?? 30) as ProfitRange;
  const [r, products] = await Promise.all([profitReport(db, shop, days), productChoices(db, shop.id)]);
  const money = (m: number) => formatMoney(m, shop.currency);
  const symbol = money(0).replace(/[\d.,\s]/g, "");
  const t = r.totals;
  const signed = (m: number) => <span className={m < 0 ? "text-critical" : ""}>{money(m)}</span>;

  return (
    <main className="pb-12">
      <PageHeader title="Profit" actions={<Link className="btn btn-secondary" href="/admin/money">Money</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-5xl">
        <nav aria-label="Period" className="flex gap-2 flex-wrap">
          {PROFIT_RANGES.map((d) => (
            <Link key={d} href={`/admin/profit?days=${d}`} className={`btn btn-sm ${d === days ? "btn-primary" : "btn-secondary"}`} aria-current={d === days ? "page" : undefined}>
              Last {d} days
            </Link>
          ))}
          <span className="hint self-center">{fmtDay(r.from)} to {fmtDay(r.to)}, {r.orders === 1 ? "1 order" : `${r.orders} orders`}</span>
        </nav>

        <section aria-label="Totals" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-border border border-border rounded-xl overflow-hidden">
          {(
            [
              ["Sales", t.salesMinor - t.refundsMinor, "After discounts and refunds"],
              ["Supplier costs", -t.costMinor, "Orders the supplier accepted"],
              ["Fees", -t.feesMinor, "Card processing and our fee"],
              ["Ads", -t.adsMinor, t.roas ? `Return on ad spend ${t.roas}×` : "Enter spend below"],
              ["Profit", t.profitMinor, t.marginPercent != null ? `${t.marginPercent}% of sales` : "No sales yet"],
              ["Break-even ROAS", null, t.breakEvenRoas ? "Ads below this lose money" : "Needs a profitable sale"],
            ] as const
          ).map(([k, v, note]) => (
            <div key={k} className="bg-surface p-4 flex flex-col gap-1">
              <span className="hint">{k}</span>
              <span className={`text-xl font-semibold num ${v != null && v < 0 && k === "Profit" ? "text-critical" : ""}`}>
                {k === "Break-even ROAS" ? (t.breakEvenRoas ? `${t.breakEvenRoas}×` : "—") : money(v ?? 0)}
              </span>
              <span className="hint text-xs">{note}</span>
            </div>
          ))}
        </section>
        {t.costMissing && (
          <p className="banner banner-warning" role="note" aria-label="Products with no cost">
            Some products have no cost, so their profit looks higher than it is.{" "}
            <Link href="/admin/products?missing=cost" className="underline">See the products with no cost</Link> and add it, one at a time or all at once.
          </p>
        )}

        <section className="card overflow-x-auto" aria-labelledby="by-product">
          <h2 id="by-product" className="font-semibold px-5 pt-4 pb-2">By product</h2>
          {r.products.length ? (
            <table className="table min-w-[760px]">
              <thead>
                <tr>
                  <th>Product</th><th className="text-right">Sold</th><th className="text-right">Sales</th><th className="text-right">Refunds</th><th className="text-right">Cost</th>
                  <th className="text-right">Fees</th><th className="text-right">Ads</th><th className="text-right">Profit</th><th className="text-right">ROAS</th><th className="text-right">Break-even</th>
                </tr>
              </thead>
              <tbody>
                {r.products.map((p) => {
                  const losing = p.roas != null && p.breakEvenRoas != null && p.roas < p.breakEvenRoas;
                  return (
                    <tr key={p.productId ?? p.title}>
                      <td>
                        {p.productId ? <Link href={`/admin/products/${p.productId}`} className="font-medium">{p.title}</Link> : <span className="font-medium">{p.title}</span>}
                        {p.costMissing && <span className="pill pill-warning ml-2">No cost</span>}
                      </td>
                      <td className="text-right num">{p.units}</td>
                      <td className="text-right num">{money(p.salesMinor)}</td>
                      <td className="text-right num">{p.refundsMinor ? `−${money(p.refundsMinor)}` : "—"}</td>
                      <td className="text-right num">−{money(p.costMinor)}</td>
                      <td className="text-right num">−{money(p.feesMinor)}</td>
                      <td className="text-right num">{p.adsMinor ? `−${money(p.adsMinor)}` : "—"}</td>
                      <td className="text-right num font-semibold">{signed(p.profitMinor)}</td>
                      <td className="text-right num">{p.roas != null ? <span className={losing ? "text-critical" : ""}>{p.roas}×</span> : "—"}</td>
                      <td className="text-right num">{p.breakEvenRoas != null ? `${p.breakEvenRoas}×` : "—"}</td>
                    </tr>
                  );
                })}
                {r.untiedAdsMinor > 0 && (
                  <tr>
                    <td className="hint">Ads for the whole store</td>
                    <td colSpan={5} />
                    <td className="text-right num">−{money(r.untiedAdsMinor)}</td>
                    <td className="text-right num font-semibold">{signed(-r.untiedAdsMinor)}</td>
                    <td colSpan={2} />
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <p className="hint px-5 pb-5">No paid orders in this period yet.</p>
          )}
          <p className="hint px-5 py-3 text-xs">
            ROAS is sales after refunds for each unit spent on ads. Break-even is the ROAS where ads use up all the profit: a product whose ROAS is below its break-even is losing money on ads, shown in red.
            Shipping you charge is set against the supplier's shipping, and tax isn't counted as sales.
            {r.giftCardSalesMinor > 0 && <> Gift cards sold ({money(r.giftCardSalesMinor)}) count when they're spent, not when they're bought.</>}
          </p>
        </section>

        <section className="card p-5 flex flex-col gap-4" aria-labelledby="ad-spend">
          <div>
            <h2 id="ad-spend" className="font-semibold">Ad spend</h2>
            <p className="hint">Enter what you spent on ads each day, from your ads dashboard. Pick a product to see its profit after ads, or leave it for the whole store.</p>
          </div>
          <AdSpendForm
            today={r.to}
            symbol={symbol}
            channels={Object.entries(AD_CHANNEL_LABELS).map(([value, label]) => ({ value, label }))}
            products={products.filter((p) => !p.giftCard && p.status !== "archived").map((p) => ({ id: p.id, title: p.title }))}
          />
          {r.ads.length > 0 && (
            <>
              {r.adsByChannel.length > 1 && (
                <p className="text-sm">{r.adsByChannel.map((c) => `${c.label} ${money(c.amountMinor)}`).join(" · ")}</p>
              )}
              <div className="overflow-x-auto">
              <table className="table min-w-[520px]" aria-label="Ad spend entered">
                <thead><tr><th>Day</th><th>Where</th><th>For</th><th className="text-right">Amount</th><th /></tr></thead>
                <tbody>
                  {[...r.ads].reverse().map((a) => (
                    <tr key={a.id}>
                      <td className="num">{fmtDay(a.day)}</td>
                      <td>{AD_CHANNEL_LABELS[a.channel]}{a.note && <span className="hint"> · {a.note}</span>}</td>
                      <td>{a.productId ? (products.find((p) => p.id === a.productId)?.title ?? "A deleted product") : <span className="hint">Whole store</span>}</td>
                      <td className="text-right num">{money(a.amountMinor)}</td>
                      <td className="text-right">
                        <form action={deleteAdSpendAction.bind(null, a.id)}>
                          <button className="btn btn-secondary btn-sm" aria-label={`Remove ${money(a.amountMinor)} on ${fmtDay(a.day)}`}>Remove</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
