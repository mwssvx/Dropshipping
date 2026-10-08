import Link from "next/link";
import { convertPrice, formatMoney, presentQuote, quoteCart, upsellsFor, UserError } from "@sf/core";
import { buyerFx } from "@/lib/currency";
import { readCart, readDiscountCode } from "@/lib/cart";
import { db } from "@/lib/server";
import { currentBuyer } from "@/lib/buyer";
import { addToCartAction, removeCodeAction, updateCartAction } from "../actions";
import { CodeForm } from "./CodeForm";
import { loadShop, storeBase } from "../data";

export const metadata = { title: "Cart" };

export default async function CartPage({ params, searchParams }: { params: Promise<{ shop: string }>; searchParams: Promise<{ unavailable?: string }> }) {
  const { shop: handle } = await params;
  const unavailable = Number((await searchParams).unavailable) || 0;
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const lines = await readCart(shop.id);
  const code = await readDiscountCode(shop.id);
  let quote: Awaited<ReturnType<typeof quoteCart>> | null = null;
  let problem: string | null = null;
  let codeProblem: string | null = null;
  // Signed-in wholesale buyers get their prices here and at checkout.
  const buyerEmail = (await currentBuyer(shop.id))?.email ?? null;
  if (lines.length) {
    try {
      quote = await quoteCart(await db(), shop, lines, { discountCode: code, buyerEmail });
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      // A code that stopped working (cart below its minimum, expired) shouldn't hide the cart.
      if (e.code === "discount_invalid") {
        codeProblem = e.message;
        quote = await quoteCart(await db(), shop, lines, { buyerEmail }).catch(() => null);
      } else problem = e.message;
    }
  }
  const variants = quote ? await (await db()).query.variants.findMany({ where: (v, { inArray }) => inArray(v.id, quote!.items.map((i) => i.variantId)) }) : [];
  const upsells = quote ? await upsellsFor(await db(), shop.id, [...new Set(variants.map((v) => v.productId))]) : [];
  // Shown in the buyer's currency when they picked one; the total is exactly what they'll pay.
  const fx = await buyerFx(shop);
  const shown = quote ? presentQuote({ ...quote, taxMinor: 0 }, fx) : null;
  const money = (m: number) => formatMoney(m, fx.currency);
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Your cart</h1>
      {quote?.wholesale && (
        <p className="banner banner-info" role="status">
          You&apos;re getting wholesale prices ({quote.wholesale.percentOff}% off).
          {quote.wholesale.shortByMinor > 0 && ` Wholesale orders start at ${formatMoney(quote.wholesale.minOrderMinor, shop.currency)}: add ${formatMoney(quote.wholesale.shortByMinor, shop.currency)} more to check out.`}
        </p>
      )}
      {problem && <p className="banner banner-critical">{problem}</p>}
      {unavailable > 0 && (
        <p className="banner banner-warning" role="status">
          {unavailable === 1 ? "One item from that order isn't" : `${unavailable} items from that order aren't`} for sale right now, so we left {unavailable === 1 ? "it" : "them"} out.
        </p>
      )}
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
                  <p className="hint num">
                    {i.listUnitPriceMinor !== i.unitPriceMinor && <s className="mr-1.5">{money(convertPrice(i.listUnitPriceMinor, fx))}</s>}
                    {money(shown!.units[i.variantId]!)} each
                  </p>
                  {i.priceNote && <p className="text-sm text-success">{i.priceNote}</p>}
                </div>
                <form action={updateCartAction.bind(null, handle)} className="flex items-center gap-2">
                  <input type="hidden" name="variantId" value={i.variantId} />
                  <label className="sr-only" htmlFor={`q-${i.variantId}`}>Quantity</label>
                  <input id={`q-${i.variantId}`} name="quantity" type="number" min={0} max={99} defaultValue={i.quantity} className="input w-16 num" />
                  <button className="btn btn-secondary">Update</button>
                </form>
                <span className="num font-semibold w-20 text-right">{money(shown!.units[i.variantId]! * i.quantity)}</span>
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 num text-sm self-end w-full max-w-xs">
            <dt className="hint">Subtotal</dt><dd className="text-right">{money(shown!.subtotalMinor)}</dd>
            {quote.discount && (
              <>
                <dt className="hint">Discount ({quote.discount.code})</dt>
                <dd className="text-right">{shown!.discountMinor ? `−${money(shown!.discountMinor)}` : quote.discount.label}</dd>
              </>
            )}
            <dt className="hint">Shipping</dt><dd className="text-right">{shown!.shippingMinor ? money(shown!.shippingMinor) : "Free"}</dd>
            <dt className="font-semibold text-base">Total</dt><dd className="font-semibold text-base text-right">{money(shown!.totalMinor)}</dd>
            <dd className="col-span-2 hint text-right font-sans">{quote.pricesIncludeTax ? "Tax included where it applies." : "Tax, if any, is added at checkout."}</dd>
          </dl>
          {quote.discount ? (
            <form action={removeCodeAction.bind(null, handle)} className="self-end flex items-center gap-2 text-sm">
              <span className="pill pill-success">{quote.discount.code}: {quote.discount.label}</span>
              <button className="underline">Remove</button>
            </form>
          ) : quote.wholesale ? null : (
            <>
              {codeProblem && <p className="banner banner-warning self-end" role="alert">{codeProblem}</p>}
              <CodeForm handle={handle} />
            </>
          )}
          {quote.wholesale && quote.wholesale.shortByMinor > 0 ? (
            <Link href={base || "/"} className="btn btn-secondary btn-lg self-end">Keep shopping</Link>
          ) : (
            <Link href={`${base}/checkout`} className="btn btn-primary btn-lg self-end">Check out</Link>
          )}
          {upsells.length > 0 && (
            <section className="flex flex-col gap-3 border-t border-border pt-6" aria-labelledby="goes-well">
              <h2 id="goes-well" className="font-semibold">Goes well with</h2>
              {upsells.map((u) => (
                <form key={u.id} action={addToCartAction.bind(null, handle)} className="flex items-center gap-4">
                  <div className="size-14 rounded-md bg-sunken overflow-hidden shrink-0">{u.imageUrl && <img src={u.imageUrl} alt="" className="size-full object-cover" />}</div>
                  <Link href={`${base}/products/${u.handle}`} className="flex-1 font-medium hover:underline">{u.title}</Link>
                  <span className="num">{money(convertPrice(u.priceMinor, fx))}</span>
                  <input type="hidden" name="variantId" value={u.variantId} />
                  <input type="hidden" name="quantity" value="1" />
                  <button className="btn btn-secondary" aria-label={`Add ${u.title} to cart`}>Add</button>
                </form>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
