import { redirect } from "next/navigation";
import { countryName, formatMoney, lastCheckoutDetails, listShippingZones, presentQuote, priceRate, quoteCart, rateDays, shipsTo, SHIPPING_COUNTRIES, UserError } from "@sf/core";
import { buyerFx } from "@/lib/currency";
import { currentBuyer } from "@/lib/buyer";
import { readCart, readDiscountCode, readGiftCardCode } from "@/lib/cart";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../data";
import { Checkout, type ZoneChoice } from "./CheckoutForm";

export const metadata = { title: "Checkout" };

export default async function CheckoutPage({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: handle } = await params;
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const lines = await readCart(shop.id);
  if (!lines.length) redirect(`${base}/cart`);
  const buyer = await currentBuyer(shop.id);
  let quote;
  try {
    quote = await quoteCart(await db(), shop, lines, { discountCode: await readDiscountCode(shop.id), giftCardCode: await readGiftCardCode(shop.id), buyerEmail: buyer?.email });
  } catch (e) {
    if (e instanceof UserError) redirect(`${base}/cart`);
    throw e;
  }
  if (quote.wholesale && quote.wholesale.shortByMinor > 0) redirect(`${base}/cart`);
  const fx = await buyerFx(shop);
  const shown = presentQuote({ ...quote, taxMinor: 0 }, fx);
  const money = (m: number) => formatMoney(m, fx.currency);
  // Signed-in buyers start with the details from their last order.
  const saved = buyer ? await lastCheckoutDetails(await db(), shop.id, buyer.email) : null;
  const initial = saved ? { email: saved.email, ...(saved.address ? Object.fromEntries(Object.entries(saved.address).map(([k, v]) => [k, String(v ?? "")])) : {}) } : undefined;
  // Every rate the buyer could pick, priced for this cart in their currency, so the summary
  // follows the country and rate they choose.
  const hasGoods = quote.items.some((i) => !i.giftCard);
  const { zones } = await listShippingZones(await db(), shop.id);
  const choices: ZoneChoice[] | null = hasGoods
    ? zones.map((z) => ({
        countries: z.countries,
        rates: z.rates.map((r) => {
          const price = quote.discount?.freeShipping ? 0 : priceRate(r, quote.goodsMinor);
          const p = presentQuote({ ...quote, shippingMinor: price, taxMinor: 0 }, fx);
          const days = rateDays(r);
          return { id: r.id, name: r.name, days: days ? `Arrives in ${days}` : null, priceMinor: p.shippingMinor, priceLabel: p.shippingMinor ? money(p.shippingMinor) : "Free", totalLabel: money(p.totalMinor) };
        }),
      }))
    : null;
  const countries = (hasGoods ? shipsTo(zones) : [...SHIPPING_COUNTRIES]).map((c) => [c, countryName(c)] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]));
  const withoutShipping = presentQuote({ ...quote, shippingMinor: 0, taxMinor: 0 }, fx);
  return (
    <Checkout
      handle={handle}
      defaultCountry={shop.country}
      initial={initial}
      paidByGiftCard={!!quote.giftCard && quote.dueMinor === 0}
      countries={countries}
      zones={choices}
      taxLabel={quote.pricesIncludeTax ? "Included" : "Next step"}
      totalLabel={quote.pricesIncludeTax ? "Total" : "Total before tax"}
      totalWithoutShipping={money(withoutShipping.totalMinor)}
      summary={
        <>
          <ul className="flex flex-col gap-2 text-sm">
            {quote.items.map((i) => (
              <li key={i.variantId} className="flex justify-between gap-3">
                <span>{i.title} <span className="hint">× {i.quantity}</span>{i.priceNote && <span className="block hint">{i.priceNote}</span>}</span>
                <span className="num">{money(shown.units[i.variantId]! * i.quantity)}</span>
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 num text-sm border-t border-border pt-3">
            <dt className="hint">Subtotal</dt><dd className="text-right">{money(shown.subtotalMinor)}</dd>
            {quote.discount && shown.discountMinor > 0 && (
              <>
                <dt className="hint">Discount ({quote.discount.code})</dt><dd className="text-right">−{money(shown.discountMinor)}</dd>
              </>
            )}
          </dl>
        </>
      }
      footer={
        <>
          {quote.giftCard && (
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 num text-sm">
              <dt className="hint">Gift card ···· {quote.giftCard.last4}</dt>
              <dd className="text-right">−{money(quote.giftCard.appliedMinor)}{quote.pricesIncludeTax ? "" : "+"}</dd>
              <dd className="col-span-2 hint text-right font-sans">The gift card pays as much as its balance covers, tax included. Anything left goes on your card.</dd>
            </dl>
          )}
          {fx.rate !== 1 && <p className="hint text-xs">Prices in {fx.currency} at today&apos;s exchange rate. You pay exactly the total shown.</p>}
        </>
      }
    />
  );
}
