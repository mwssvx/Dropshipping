import Link from "next/link";
import { convertAmount, convertPrice, formatMoney, pointsFor, presentQuote, quoteCart, recentlyViewed, upsellsFor, boughtTogether, onHoliday, UserError } from "@sf/core";
import { buyerCountry, buyerFx } from "@/lib/currency";
import { readCart, readDiscountCode, readGiftCardCode } from "@/lib/cart";
import { db } from "@/lib/server";
import { currentBuyer } from "@/lib/buyer";
import { readRecent } from "@/lib/recent";
import { RecentlyViewed } from "@/components/RecentlyViewed";
import { addToCartAction, removeCodeAction, removeGiftCardAction, updateCartAction } from "../actions";
import { CodeForm } from "./CodeForm";
import { lineTitles, loadShop, localProducts, storeBase, storeLang, storeT } from "../data";

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
  const opts = { discountCode: code, giftCardCode: await readGiftCardCode(shop.id), buyerEmail, countryHint: await buyerCountry() };
  // A code that stopped working (cart below its minimum, expired, gift card used up) shouldn't
  // hide the cart: it's shown as a problem and the cart is priced without it.
  for (let tries = 0; lines.length && !quote && !problem && tries < 3; tries++) {
    try {
      quote = await quoteCart(await db(), shop, lines, opts);
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      if (e.code === "discount_invalid" && opts.discountCode) opts.discountCode = null;
      else if (e.code === "gift_card_invalid" && opts.giftCardCode) opts.giftCardCode = null;
      else {
        problem = e.message;
        break;
      }
      codeProblem = e.message;
    }
  }
  const variants = quote ? await (await db()).query.variants.findMany({ where: (v, { inArray }) => inArray(v.id, quote!.items.map((i) => i.variantId)) }) : [];
  // The merchant's own picks first, then what other buyers bought with these, up to three.
  const inCart = [...new Set(variants.map((v) => v.productId))];
  const picks = quote ? [...(await upsellsFor(await db(), shop.id, inCart)), ...(await boughtTogether(await db(), shop.id, inCart))] : [];
  const upsells = await localProducts(handle, picks.filter((p, i) => picks.findIndex((x) => x.id === p.id) === i).slice(0, 3));
  const recent = await localProducts(handle, await recentlyViewed(await db(), shop.id, await readRecent(shop.id), { exclude: [...new Set(variants.map((v) => v.productId))] }));
  // Item titles in the buyer's language, by the product each option belongs to.
  const t = await storeT(handle);
  const lang = (await storeLang(handle)) ?? "en-US";
  const shipsBy = (d: string) => new Intl.DateTimeFormat(lang, { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const titles = await lineTitles(handle, quote?.items ?? [], variants);
  // Shown in the buyer's currency when they picked one; the total is exactly what they'll pay.
  const fx = await buyerFx(shop);
  const shown = quote ? presentQuote({ ...quote, taxMinor: 0 }, fx) : null;
  const money = (m: number) => formatMoney(m, fx.currency);
  const otherCurrency = fx.currency !== shop.currency;
  // Points this order would earn: goods after discounts, less what a gift card pays.
  const points = quote && shop.rewardsEnabled && !quote.wholesale ? pointsFor(shop, quote.goodsMinor - quote.discountMinor - (quote.giftCard?.appliedMinor ?? 0)) : 0;
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">{t.yourCart}</h1>
      {quote?.wholesale && (
        <p className="banner banner-info" role="status">
          {t.wholesaleCart(quote.wholesale.percentOff)}
          {quote.wholesale.shortByMinor > 0 && ` ${t.wholesaleShort(formatMoney(quote.wholesale.minOrderMinor, shop.currency), formatMoney(quote.wholesale.shortByMinor, shop.currency))}`}
        </p>
      )}
      {problem && <p className="banner banner-critical">{problem}</p>}
      {unavailable > 0 && (
        <p className="banner banner-warning" role="status">
          {t.unavailable(unavailable)}
        </p>
      )}
      {!quote ? (
        <div className="flex flex-col gap-4 items-start">
          <p className="hint">{t.cartEmpty}</p>
          <Link href={base || "/"} className="btn btn-secondary">{t.keepShopping}</Link>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border border-y border-border">
            {quote.items.map((i, n) => (
              <li key={i.key} className="py-4 flex gap-4 items-center">
                <div className="size-16 rounded-md bg-sunken overflow-hidden shrink-0">
                  {i.imageUrl && <img src={i.imageUrl} alt="" className="size-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <Link href={`${base}/products/${i.productHandle}`} className="font-medium hover:underline">{titles.get(i.variantId) ?? i.title}</Link>
                  <p className="hint num">
                    {i.listUnitPriceMinor !== i.unitPriceMinor && <s className="mr-1.5">{money(convertPrice(i.listUnitPriceMinor, fx))}</s>}
                    {money(shown!.units[i.variantId]!)} {t.each}
                  </p>
                  {i.personalization?.map((p) => (
                    <p key={p.fieldId} className="text-sm"><span className="hint">{p.label}:</span> {p.value}</p>
                  ))}
                  {i.missingPersonalization.length > 0 && (
                    <p className="text-sm text-critical" role="alert">{t.personalizeMissing(i.missingPersonalization.join(", "))}</p>
                  )}
                  {i.limit && (
                    <p className="text-sm text-critical" role="alert">
                      {i.limit.kind === "min" ? t.limitMin(i.limit.limit) : i.limit.kind === "max" ? t.limitMax(i.limit.limit) : t.limitCustomer(i.limit.limit, i.limit.bought)}
                    </p>
                  )}
                  {i.preorderShipsBy && <p className="text-sm font-medium">{t.preorderShipsBy(shipsBy(i.preorderShipsBy))}</p>}
                  {i.priceNote && <p className="text-sm text-success">{i.priceNote}</p>}
                </div>
                <form action={updateCartAction.bind(null, handle)} className="flex items-center gap-2">
                  <input type="hidden" name="line" value={i.key} />
                  <label className="sr-only" htmlFor={`q-${n}`}>{t.quantity}</label>
                  <input id={`q-${n}`} name="quantity" type="number" min={0} max={Math.min(99, i.purchaseLimit?.max ?? 99)} defaultValue={i.quantity} className="input w-16 num" />
                  <button className="btn btn-secondary">{t.update}</button>
                </form>
                <span className="num font-semibold w-20 text-right">{money(shown!.units[i.variantId]! * i.quantity)}</span>
              </li>
            ))}
          </ul>
          {quote.freeShipping && !quote.wholesale && (
            <div className="self-end w-full max-w-xs flex flex-col gap-1.5" role="status">
              <p className="text-sm">{quote.freeShipping.shortByMinor > 0 ? t.freeShippingShort(money(convertAmount(quote.freeShipping.shortByMinor, fx))) : t.freeShippingReached}</p>
              <div className="h-2 rounded-full bg-sunken overflow-hidden" role="progressbar" aria-label={t.freeShippingProgress}
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(100 * Math.min(1, quote.goodsMinor / quote.freeShipping.overMinor))}>
                <div className="h-full rounded-full bg-success" style={{ width: `${Math.min(100, (100 * quote.goodsMinor) / quote.freeShipping.overMinor)}%` }} />
              </div>
            </div>
          )}
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 num text-sm self-end w-full max-w-xs">
            <dt className="hint">{t.subtotal}</dt><dd className="text-right">{money(shown!.subtotalMinor)}</dd>
            {quote.discount && (
              <>
                <dt className="hint">{t.discount} ({quote.discount.automatic ? quote.discount.label : quote.discount.code})</dt>
                <dd className="text-right">{shown!.discountMinor ? `−${money(shown!.discountMinor)}` : quote.discount.label}</dd>
              </>
            )}
            {quote.bundle && (
              <>
                <dt className="hint">{t.bundle} ({quote.bundle.title})</dt>
                <dd className="text-right">−{money(shown!.discountMinor)}</dd>
              </>
            )}
            <dt className="hint">{t.shipping}</dt>
            <dd className="text-right">{shown!.shippingMinor ? money(shown!.shippingMinor) : quote.shipping || quote.items.every((i) => i.giftCard) ? t.free : t.atCheckout}</dd>
            <dt className="font-semibold text-base">{t.total}</dt><dd className="font-semibold text-base text-right">{money(shown!.totalMinor)}</dd>
            {quote.giftCard && !otherCurrency && (
              <>
                <dt className="hint">{t.giftCard} ···· {quote.giftCard.last4}</dt><dd className="text-right">−{money(quote.giftCard.appliedMinor)}</dd>
                <dt className="font-semibold">{t.toPay}</dt><dd className="font-semibold text-right">{money(quote.dueMinor)}</dd>
              </>
            )}
            <dd className="col-span-2 hint text-right font-sans">{quote.pricesIncludeTax ? t.taxIncludedNote : t.taxAddedNote}</dd>
            {points > 0 && <dd className="col-span-2 text-right font-sans text-success">{t.rewardsEarn(points.toLocaleString("en-US"))}</dd>}
          </dl>
          {quote.offerNudge && (
            <p className="self-end banner banner-info text-sm" role="status">{quote.offerNudge.label}: {t.offerNudge(quote.offerNudge.missing, quote.offerNudge.free)}</p>
          )}
          {quote.discount && !quote.discount.automatic && (
            <form action={removeCodeAction.bind(null, handle)} className="self-end flex items-center gap-2 text-sm">
              <span className="pill pill-success">{quote.discount.code}: {quote.discount.label}</span>
              <button className="underline">{t.remove}</button>
            </form>
          )}
          {quote.giftCard && (
            <form action={removeGiftCardAction.bind(null, handle)} className="self-end flex flex-col items-end gap-1 text-sm">
              <span className="flex items-center gap-2">
                <span className="pill pill-success">{t.giftCard} ···· {quote.giftCard.last4}</span>
                <button className="underline">{t.remove}</button>
              </span>
              <span className="hint num">
                {otherCurrency
                  ? t.giftCardOtherCurrency(shop.currency)
                  : t.giftCardLeft(formatMoney(quote.giftCard.balanceMinor - quote.giftCard.appliedMinor, shop.currency))}
              </span>
            </form>
          )}
          {codeProblem && <p className="banner banner-warning self-end" role="alert">{codeProblem}</p>}
          {quote.codeNotUsed && (
            <form action={removeCodeAction.bind(null, handle)} className="self-end flex flex-col items-end gap-1 text-sm">
              <p className="banner banner-info" role="status">{t.bundleBeatsCode(quote.codeNotUsed)}</p>
              <button className="underline">{t.remove} {quote.codeNotUsed}</button>
            </form>
          )}
          {(!(quote.discount || quote.codeNotUsed) || !quote.giftCard) && <CodeForm handle={handle} text={{ label: t.codeLabel, apply: t.apply, checking: t.checking }} />}
          {onHoliday(shop) ? (
            <p className="self-end banner banner-info" role="status">{t.holidayNoCheckout}</p>
          ) : quote.wholesale && quote.wholesale.shortByMinor > 0 ? (
            <Link href={base || "/"} className="btn btn-secondary btn-lg self-end">{t.keepShopping}</Link>
          ) : (
            <Link href={`${base}/checkout`} className="btn btn-primary btn-lg self-end">{t.checkOut}</Link>
          )}
          {upsells.length > 0 && (
            <section className="flex flex-col gap-3 border-t border-border pt-6" aria-labelledby="goes-well">
              <h2 id="goes-well" className="font-semibold">{t.goesWellWith}</h2>
              {upsells.map((u) => (
                <form key={u.id} action={addToCartAction.bind(null, handle)} className="flex items-center gap-4">
                  <div className="size-14 rounded-md bg-sunken overflow-hidden shrink-0">{u.imageUrl && <img src={u.imageUrl} alt="" className="size-full object-cover" />}</div>
                  <Link href={`${base}/products/${u.handle}`} className="flex-1 font-medium hover:underline">{u.title}</Link>
                  <span className="num">{money(convertPrice(u.priceMinor, fx))}</span>
                  <input type="hidden" name="variantId" value={u.variantId} />
                  <input type="hidden" name="quantity" value="1" />
                  <button className="btn btn-secondary" aria-label={t.addNamed(u.title)}>{t.add}</button>
                </form>
              ))}
            </section>
          )}
        </>
      )}
      <RecentlyViewed items={recent} base={base} currency={shop.currency} fx={fx} title={t.recentlyViewed} soldOut={t.soldOut} className="border-t border-border pt-6" />
    </main>
  );
}

