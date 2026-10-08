import Link from "next/link";
import { formatMoney, quoteCart, UserError } from "@sf/core";
import { readCart } from "@/lib/cart";
import { db } from "@/lib/server";
import { updateCartAction } from "../actions";
import { loadShop, storeBase } from "../data";

export const metadata = { title: "Cart" };

export default async function CartPage({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: handle } = await params;
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const lines = await readCart(shop.id);
  let quote: Awaited<ReturnType<typeof quoteCart>> | null = null;
  let problem: string | null = null;
  if (lines.length) {
    try {
      quote = await quoteCart(await db(), shop, lines);
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      problem = e.message;
    }
  }
  const money = (m: number) => formatMoney(m, shop.currency);
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Your cart</h1>
      {problem && <p className="banner banner-critical">{problem}</p>}
      {!quote ? (
        <div className="flex flex-col gap-4 items-start">
          <p className="hint">Your cart is empty.</p>
          <Link href={base || "/"} className="btn btn-secondary">Keep shopping</Link>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border border-y border-border">
            {quote.items.map((i) => (
              <li key={i.variantId} className="py-4 flex gap-4 items-center">
                <div className="size-16 rounded-md bg-sunken overflow-hidden shrink-0">
                  {i.imageUrl && <img src={i.imageUrl} alt="" className="size-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <Link href={`${base}/products/${i.productHandle}`} className="font-medium hover:underline">{i.title}</Link>
                  <p className="hint num">{money(i.unitPriceMinor)} each</p>
                </div>
                <form action={updateCartAction.bind(null, handle)} className="flex items-center gap-2">
                  <input type="hidden" name="variantId" value={i.variantId} />
                  <label className="sr-only" htmlFor={`q-${i.variantId}`}>Quantity</label>
                  <input id={`q-${i.variantId}`} name="quantity" type="number" min={0} max={99} defaultValue={i.quantity} className="input w-16 num" />
                  <button className="btn btn-secondary">Update</button>
                </form>
                <span className="num font-semibold w-20 text-right">{money(i.lineMinor)}</span>
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 num text-sm self-end w-full max-w-xs">
            <dt className="hint">Subtotal</dt><dd className="text-right">{money(quote.subtotalMinor)}</dd>
            <dt className="hint">Shipping</dt><dd className="text-right">{quote.shippingMinor ? money(quote.shippingMinor) : "Free"}</dd>
            <dt className="font-semibold text-base">Total</dt><dd className="font-semibold text-base text-right">{money(quote.totalMinor)}</dd>
          </dl>
          <Link href={`${base}/checkout`} className="btn btn-primary btn-lg self-end">Check out</Link>
        </>
      )}
    </main>
  );
}
