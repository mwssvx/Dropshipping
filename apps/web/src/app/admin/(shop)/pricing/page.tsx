import Link from "next/link";
import { compareAtFor, formatMoney, keepsFromSale, previewRepricing, priceFromCost, pricingRuleOf } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { PricingRuleForm, RepriceButton } from "./PricingForms";

export const metadata = { title: "Pricing" };

const SAMPLE_COSTS = [300, 800, 2000];

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ updated?: string; products?: string }> }) {
  const query = await searchParams;
  const { shop, db } = await requireShop("products");
  const rule = pricingRuleOf(shop);
  const { rows, noCost, products } = await previewRepricing(db, shop, rule);
  const money = (m: number) => formatMoney(m, shop.currency);
  const symbol = money(0).replace(/[\d.,\s]/g, "");
  const decimal = (m: number) => (m / 100).toFixed(2);
  return (
    <main className="pb-12">
      <PageHeader title="Pricing" back={<Link href="/admin/products" className="hint hover:text-ink">← Products</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-4xl">
        <section className="card p-5 flex flex-col gap-4" aria-labelledby="rule-heading">
          <div>
            <h2 id="rule-heading" className="font-semibold">Your pricing rule</h2>
            <p className="text-sm hint">Sets the starting price of every product you import. You can still change any price by hand.</p>
          </div>
          <PricingRuleForm
            symbol={symbol}
            initial={{
              kind: rule.kind,
              multiplier: rule.kind === "multiplier" ? String(rule.value) : "2.5",
              fixedValue: rule.kind === "fixed" ? decimal(rule.value) : "10.00",
              ending: rule.ending,
              compareAt: !!rule.compareAtPercent,
              compareAtPercent: String(rule.compareAtPercent ?? 30),
              minPrice: decimal(rule.minPriceMinor),
            }}
          />
          <table className="table text-sm" aria-label="Examples">
            <thead><tr><th>Supplier cost</th><th className="text-right">Price</th><th className="text-right">You keep, after fees</th></tr></thead>
            <tbody>
              {SAMPLE_COSTS.map((c) => {
                const price = priceFromCost(c, rule);
                const was = compareAtFor(price, rule);
                return (
                  <tr key={c}>
                    <td className="num">{money(c)}</td>
                    <td className="num text-right">{was ? <s className="hint mr-2">{money(was)}</s> : null}{money(price)}</td>
                    <td className="num text-right">{money(keepsFromSale(shop, price, c))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="card p-5 flex flex-col gap-4" aria-labelledby="reprice-heading">
          <div>
            <h2 id="reprice-heading" className="font-semibold">Products that don&apos;t follow the rule</h2>
            <p className="text-sm hint">
              {rows.length
                ? `${products === 1 ? "1 product has" : `${products} products have`} prices your rule would change. Check them, then update them all at once.`
                : "Every product with a known supplier cost already follows your rule."}
              {noCost > 0 && ` ${noCost === 1 ? "1 option has" : `${noCost} options have`} no supplier cost, so ${noCost === 1 ? "it's" : "they're"} left alone.`}
            </p>
          </div>
          {query.updated && (
            <p className="banner banner-success" role="status">
              Updated {query.updated === "1" ? "1 price" : `${Number(query.updated)} prices`} on {query.products === "1" ? "1 product" : `${Number(query.products)} products`}.
            </p>
          )}
          {rows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="table min-w-[560px] text-sm">
                  <thead><tr><th>Product</th><th className="text-right">Cost</th><th className="text-right">Now</th><th className="text-right">New</th><th className="text-right">You keep</th></tr></thead>
                  <tbody>
                    {rows.slice(0, 100).map((r) => (
                      <tr key={r.variantId}>
                        <td><Link href={`/admin/products/${r.productId}`} className="font-medium">{r.product}</Link>{r.variant !== "Default" && <span className="hint"> · {r.variant}</span>}</td>
                        <td className="num text-right">{money(r.costMinor)}</td>
                        <td className="num text-right">{money(r.priceMinor)}</td>
                        <td className="num text-right font-medium">{r.newCompareAtMinor ? <s className="hint font-normal mr-2">{money(r.newCompareAtMinor)}</s> : null}{money(r.newPriceMinor)}</td>
                        <td className="num text-right">{money(keepsFromSale(shop, r.newPriceMinor, r.costMinor))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 100 && <p className="hint text-sm">And {rows.length - 100} more.</p>}
              <RepriceButton label={`Update ${products === 1 ? "1 product" : `${products} products`}`} />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
