import { redirect } from "next/navigation";
import { formatMoney, quoteCart, UserError } from "@sf/core";
import { readCart } from "@/lib/cart";
import { db } from "@/lib/server";
import { loadShop } from "../data";
import { CheckoutForm } from "./CheckoutForm";

export const metadata = { title: "Checkout" };

export default async function CheckoutPage({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: handle } = await params;
  const shop = await loadShop(handle);
  const lines = await readCart(shop.id);
  if (!lines.length) redirect(`/s/${handle}/cart`);
  let quote;
  try {
    quote = await quoteCart(await db(), shop, lines);
  } catch (e) {
    if (e instanceof UserError) redirect(`/s/${handle}/cart`);
    throw e;
  }
  const money = (m: number) => formatMoney(m, shop.currency);
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 grid gap-10 md:grid-cols-[1fr_340px] items-start">
      <div className="flex flex-col gap-6 min-w-0">
        <h1 className="text-3xl font-bold tracking-tight">Checkout</h1>
        <CheckoutForm handle={handle} defaultCountry={shop.country} />
      </div>
      <aside className="card p-5 flex flex-col gap-4 md:sticky md:top-6 bg-sunken border-0">
        <h2 className="font-semibold">Order summary</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {quote.items.map((i) => (
            <li key={i.variantId} className="flex justify-between gap-3">
              <span>{i.title} <span className="hint">× {i.quantity}</span></span>
              <span className="num">{money(i.lineMinor)}</span>
            </li>
          ))}
        </ul>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1 num text-sm border-t border-border pt-3">
          <dt className="hint">Subtotal</dt><dd className="text-right">{money(quote.subtotalMinor)}</dd>
          <dt className="hint">Shipping</dt><dd className="text-right">{quote.shippingMinor ? money(quote.shippingMinor) : "Free"}</dd>
          <dt className="hint">Tax</dt><dd className="text-right">{money(quote.taxMinor)}</dd>
          <dt className="font-semibold text-base">Total</dt><dd className="font-semibold text-base text-right">{money(quote.totalMinor)}</dd>
        </dl>
      </aside>
    </main>
  );
}
