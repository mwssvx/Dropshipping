import { convertPrice, CURRENCIES, CURRENCY_NAMES, crossRate, formatMoney, sampleProduct } from "@sf/core";
import { fxRates, requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { CurrenciesForm } from "./CurrenciesForm";

export const metadata = { title: "Currencies" };

export default async function CurrenciesPage() {
  const { shop, db } = await requireShop("currencies");
  const [{ rates, asOf }, sample] = await Promise.all([fxRates().rates(), sampleProduct(db, shop.id)]);
  const others = CURRENCIES.filter((c) => c !== shop.currency);
  const samplePrice = sample?.variants[0]?.priceMinor ?? 2499;

  return (
    <main className="pb-12">
      <PageHeader title="Currencies" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <p className="hint">
          Your prices are in {CURRENCY_NAMES[shop.currency] ?? shop.currency} ({shop.currency}). Turn on other currencies and buyers see prices,
          pay and get refunds in their own, converted at the European Central Bank&apos;s daily rate. They get their own currency
          automatically when they shop from that country, and can switch at the top of the store.
        </p>
        <section className="card p-5 flex flex-col gap-4" aria-labelledby="currencies-heading">
          <h2 id="currencies-heading" className="font-semibold">Currencies buyers can use</h2>
          <CurrenciesForm
            storeCurrency={shop.currency}
            options={others.map((c) => ({ code: c, name: CURRENCY_NAMES[c] ?? c }))}
            enabled={shop.presentmentCurrencies}
            round={shop.roundConvertedPrices}
          />
        </section>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="rates-heading">
          <h2 id="rates-heading" className="font-semibold">Today&apos;s rates</h2>
          <table className="w-full text-sm">
            <thead className="text-left hint">
              <tr>
                <th className="font-medium py-1">Currency</th>
                <th className="font-medium py-1 text-right">1 {shop.currency} is</th>
                <th className="font-medium py-1 text-right">{sample ? sample.title : "A product"} at {formatMoney(samplePrice, shop.currency)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border num">
              {others.map((c) => {
                const rate = crossRate(rates, shop.currency, c);
                return (
                  <tr key={c}>
                    <td className="py-2">{c}</td>
                    <td className="py-2 text-right">{rate.toFixed(4)}</td>
                    <td className="py-2 text-right">{formatMoney(convertPrice(samplePrice, { currency: c, rate, round: shop.roundConvertedPrices }), c)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint text-sm">Rates as of {asOf}. Each order keeps the rate it was placed at.</p>
          <p className="hint text-sm">
            We don&apos;t add anything to the rate. Stripe converts the payment into {shop.currency} for your payouts and charges its own
            conversion fee, which shows on each payout. Shipping and tax are converted exactly; only product prices are rounded.
          </p>
        </section>
      </div>
    </main>
  );
}
