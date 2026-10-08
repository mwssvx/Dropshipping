import { redirect } from "next/navigation";
import { formatMoney, lastCheckoutDetails, presentQuote, quoteCart, UserError } from "@sf/core";
import { buyerFx } from "@/lib/currency";
import { currentBuyer } from "@/lib/buyer";
import { readCart, readDiscountCode } from "@/lib/cart";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../data";
import { CheckoutForm } from "./CheckoutForm";

export const metadata = { title: "Checkout" };

export default async function CheckoutPage({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: handle } = await params;
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const lines = await readCart(shop.id);
  if (!lines.length) redirect(`${base}/cart`);
  let quote;
  try {
    quote = await quoteCart(await db(), shop, lines, { discountCode: await readDiscountCode(shop.id) });
  } catch (e) {
    if (e instanceof UserError) redirect(`${base}/cart`);
    throw e;
  }
  const fx = await buyerFx(shop);
  const shown = presentQuote({ ...quote, taxMinor: 0 }, fx);
  const money = (m: number) => formatMoney(m, fx.currency);
  // Signed-in buyers start with the details from their last order.
  const buyer = await currentBuyer(shop.id);
  const saved = buyer ? await lastCheckoutDetails(await db(), shop.id, buyer.email) : null;
  const initial = saved ? { email: saved.email, ...(saved.address ? Object.fromEntries(Object.entries(saved.address).map(([k, v]) => [k, String(v ?? "")])) : {}) } : undefined;
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 grid gap-10 md:grid-cols-[1fr_340px] items-start">
      <div className="flex flex-col gap-6 min-w-0">
        <h1 className="text-3xl font-bold tracking-tight">Checkout</h1>
        <CheckoutForm handle={handle} defaultCountry={shop.country} initial={initial} />
      </div>
      <aside className="card p-5 flex flex-col gap-4 md:sticky md:top-6 bg-sunken border-0">
        <h2 className="font-semibold">Order summary</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {quote.items.map((i) => (
            <li key={i.variantId} className="flex justify-between gap-3">
              <span>{i.title} <span className="hint">× {i.quantity}</span></span>
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
          <dt className="hint">Shipping</dt><dd className="text-right">{shown.shippingMinor ? money(shown.shippingMinor) : "Free"}</dd>
          <dt className="hint">Tax</dt><dd className="text-right hint">{quote.pricesIncludeTax ? "Included" : "Next step"}</dd>
          <dt className="font-semibold text-base">{quote.pricesIncludeTax ? "Total" : "Total before tax"}</dt><dd className="font-semibold text-base text-right">{money(shown.totalMinor)}</dd>
        </dl>
        {fx.rate !== 1 && <p className="hint text-xs">Prices in {fx.currency} at today's exchange rate. You pay exactly the total shown.</p>}
      </aside>
    </main>
  );
}
