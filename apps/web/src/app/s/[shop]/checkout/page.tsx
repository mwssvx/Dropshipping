import { PixelEvent } from "@/components/PixelEvent";
import { redirect } from "next/navigation";
import { addonOffer, formatDeliveryWindow, rateDeliveryWindows, formatHandoverDay, handoverDates, convertAmount, convertPrice, protectionFee, countryName, fitsWeight, formatMoney, GIFT_CARD_SEND_DAYS, lastCheckoutDetails, savedAddresses, dutiesFor, shipsFromOf, listShippingZones, presentQuote, priceRate, quoteCart, shipsTo, SHIPPING_COUNTRIES, onHoliday, LOCAL_DELIVERY_RATE_ID, localDeliveryPrice, PICKUP_RATE_ID, storePixels, taxExemptionFor, tipAmount, UserError } from "@sf/core";
import { buyerFx, chosenCountry } from "@/lib/currency";
import { currentBuyer } from "@/lib/buyer";
import { readCart, readDiscountCode, readGiftCardCode } from "@/lib/cart";
import { db } from "@/lib/server";
import { countryNames } from "@/lib/store-text";
import { lineTitles, loadShop, localProducts, storeBase, storeLang, storeT } from "../data";
import { addAddonAction } from "../actions";
import { AddonOffer } from "./AddonOffer";
import { Checkout, type RateChoice, type ZoneChoice } from "./CheckoutForm";

export const metadata = { title: "Checkout" };

export default async function CheckoutPage({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: handle } = await params;
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const lines = await readCart(shop.id);
  // Empty, or the store is on a break: the cart says what's going on.
  if (!lines.length || onHoliday(shop)) redirect(`${base}/cart`);
  const buyer = await currentBuyer(shop.id);
  let quote;
  try {
    quote = await quoteCart(await db(), shop, lines, { discountCode: await readDiscountCode(shop.id), giftCardCode: await readGiftCardCode(shop.id), buyerEmail: buyer?.email });
  } catch (e) {
    if (e instanceof UserError) redirect(`${base}/cart`);
    throw e;
  }
  if (quote.wholesale && quote.wholesale.shortByMinor > 0) redirect(`${base}/cart`);
  if (quote.minimumOrder && quote.minimumOrder.shortByMinor > 0) redirect(`${base}/cart`);
  // The cart says which personalisation is missing.
  if (quote.items.some((i) => i.missingPersonalization.length)) redirect(`${base}/cart`);
  // And which quantities are outside a product's purchase limits.
  if (quote.items.some((i) => i.limit)) redirect(`${base}/cart`);
  const fx = await buyerFx(shop);
  const t = await storeT(handle);
  const exempt = buyer ? await taxExemptionFor(await db(), shop.id, buyer.email) : null;
  const variants = await (await db()).query.variants.findMany({ where: (v, { inArray }) => inArray(v.id, quote.items.map((i) => i.variantId)) });
  const titles = await lineTitles(handle, quote.items, variants);
  const shown = presentQuote({ ...quote, taxMinor: 0 }, fx);
  const money = (m: number) => formatMoney(m, fx.currency);
  // Signed-in buyers start with the details from their last order.
  const saved = buyer ? await lastCheckoutDetails(await db(), shop.id, buyer.email) : null;
  const initial = saved ? { email: saved.email, ...(saved.address ? Object.fromEntries(Object.entries(saved.address).map(([k, v]) => [k, String(v ?? "")])) : {}) } : undefined;
  // And can send it to another address they've used before.
  const addresses = buyer
    ? (await savedAddresses(await db(), shop.id, buyer.email)).map((a) => ({
        label: [a.name, a.line1, a.line2, `${a.city} ${a.postalCode}`.trim()].filter(Boolean).join(", "),
        values: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, String(v ?? "")])),
      }))
    : undefined;
  // Every rate the buyer could pick, priced for this cart in their currency, so the summary
  // follows the country and rate they choose.
  // Gift cards and downloads need no address, shipping or delivery add-ons.
  const hasGoods = quote.needsShipping;
  // Delivery protection, when the store offers it and something ships. Priced on the items after discounts.
  const protectionMinor = hasGoods && shop.deliveryProtection ? protectionFee(shop.deliveryProtection, quote.goodsMinor - quote.discountMinor) : 0;
  const { zones } = await listShippingZones(await db(), shop.id);
  // The dates each rate would arrive on, counted like the cart's, where the store shows dates.
  const windows = hasGoods ? await rateDeliveryWindows(await db(), shop, quote.items, zones.flatMap((z) => z.rates)) : new Map();
  const dayLang = (await storeLang(handle)) ?? "en-US";
  const shortDay = new Intl.DateTimeFormat(dayLang, { month: "short", day: "numeric", timeZone: "UTC" });
  const choices: ZoneChoice[] | null = hasGoods
    ? zones.map((z) => ({
        countries: z.countries,
        // Rates for other weights (a heavy-parcel rate on a light cart) don't show.
        rates: z.rates.filter((r) => fitsWeight(r, quote.weightGrams)).map((r) => {
          const price = quote.discount?.freeShipping ? 0 : priceRate(r, quote.goodsMinor) + quote.surchargeMinor;
          const p = presentQuote({ ...quote, shippingMinor: price, taxMinor: 0 }, fx);
          const window = windows.get(r.id);
          const days = window ? t.arrivesOn(formatDeliveryWindow(window, (d) => shortDay.format(d))) : r.minDays !== null && r.maxDays !== null ? t.arrivesIn(r.minDays, r.maxDays) : null;
          return {
            id: r.id, name: r.name, days, priceMinor: p.shippingMinor, priceLabel: p.shippingMinor ? money(p.shippingMinor) : t.free, totalMinor: p.totalMinor,
          };
        }),
      }))
    : null;
  // Picking up and the store's own delivery sit next to the rates for its own country.
  const homeZone = (zs: ZoneChoice[]) => {
    const own = zs.find((z) => z.countries.includes(shop.country));
    if (own) return own;
    const made = { countries: [shop.country], rates: [...(zs.find((z) => z.countries.includes("*"))?.rates ?? [])] };
    zs.unshift(made);
    return made;
  };
  // Where the store lets buyers pick the day they collect it or get it delivered.
  const dates = shop.handoverDays ? handoverDates(shop.handoverDays).map((d) => [d, formatHandoverDay(d, dayLang)] as [string, string]) : undefined;
  if (choices && quote.canPickUp && shop.localPickup) {
    const pickup: RateChoice = {
      id: PICKUP_RATE_ID, name: t.pickUp, days: t.pickupFrom(shop.localPickup.address.split("\n")[0]!), priceMinor: 0, priceLabel: t.free,
      totalMinor: presentQuote({ ...quote, shippingMinor: 0, taxMinor: 0 }, fx).totalMinor, pickup: true, dates,
    };
    homeZone(choices).rates.push(pickup);
  }
  // The store's own delivery, shown once the postal code is in its area.
  if (choices && quote.ownStock && shop.localDeliveryArea) {
    const area = shop.localDeliveryArea;
    const price = quote.discount?.freeShipping ? 0 : localDeliveryPrice(area, quote.goodsMinor);
    const p = presentQuote({ ...quote, shippingMinor: price, taxMinor: 0 }, fx);
    homeZone(choices).rates.push({
      id: LOCAL_DELIVERY_RATE_ID, name: t.localDelivery, days: area.note ?? t.deliveredBy(shop.name), priceMinor: p.shippingMinor,
      priceLabel: p.shippingMinor ? money(p.shippingMinor) : t.free, totalMinor: p.totalMinor, postalPrefixes: area.postalPrefixes, dates,
    });
  }
  const lang = await storeLang(handle);
  const nameOf = countryNames(lang);
  const shipped = hasGoods ? shipsTo(zones) : [...SHIPPING_COUNTRIES];
  if ((quote.canPickUp || (quote.ownStock && shop.localDeliveryArea)) && !shipped.includes(shop.country)) shipped.push(shop.country);
  // The country picked under "Deliver to" on a product page starts the address.
  const picked = await chosenCountry();
  const startCountry = picked && shipped.includes(picked) ? picked : shop.country;
  const countries = shipped.map((c) => [c, nameOf(c, countryName(c))] as [string, string]).sort((a, b) => a[1].localeCompare(b[1], lang ?? "en"));
  // Who pays import duties, said for the countries an order would cross customs to.
  // Products shipping from a warehouse abroad cross customs even to the store's own country.
  const origins = hasGoods ? await shipsFromOf(await db(), { productIds: [...new Set(variants.map((v) => v.productId))] }) : [];
  const dutyCountries = hasGoods ? shipped.filter((c) => dutiesFor(shop, c, origins.length ? origins : null)) : [];
  const duties = dutyCountries.length ? { countries: dutyCountries, note: shop.duties === "included" ? t.dutiesIncluded("{country}") : t.dutiesBuyerPays("{country}") } : null;
  const withoutShipping = presentQuote({ ...quote, shippingMinor: 0, taxMinor: 0 }, fx);
  // One more product for a little less, unless this is a wholesale or gift-card-only order.
  const offer = !quote.wholesale && hasGoods ? await addonOffer(await db(), shop, [...new Set(variants.map((v) => v.productId))]) : null;
  const offerTitle = offer ? (await localProducts(handle, [{ id: offer.product.id, title: offer.product.title }]))[0]!.title : "";
  return (
    <>
      {storePixels(shop) && <PixelEvent name="begin_checkout" data={{ ids: quote.items.map((i) => i.variantId), value: (quote.goodsMinor - quote.discountMinor) / 100, currency: shop.currency }} />}
      <Checkout
        handle={handle}
        defaultCountry={startCountry}
        initial={initial}
        addresses={addresses}
        duties={duties}
        askPhone={shop.checkoutPhone}
        paidByGiftCard={!!quote.giftCard && quote.dueMinor === 0}
        countries={countries}
        zones={choices}
        text={{
          checkout: t.checkout, orderSummary: t.orderSummary, contact: t.contact, newsAndOffers: t.newsAndOffers, delivery: t.delivery, email: t.email,
          fullName: t.fullName, address: t.address, address2: t.address2, city: t.city, region: t.region, postalCode: t.postalCode, country: t.country,
          phone: shop.checkoutPhone === "required" ? t.phone : t.phoneOptional,
          shipping: t.shipping, noShipping: t.noShipping, placeOrder: t.placeOrder, continueToPayment: t.continueToPayment, continuing: t.continuing,
          notAvailable: t.notAvailable, tax: t.tax, giftCheckbox: t.giftCheckbox, giftFrom: t.giftFrom, giftMessage: t.giftMessage,
          giftRecipientEmail: t.giftRecipientEmail, giftNote: t.giftNote, orderNote: t.orderNote,
          giftCardTo: t.giftCardTo, giftCardEmail: t.giftCardEmail, giftCardName: t.giftCardName, giftCardFrom: t.giftCardFrom,
          giftCardMessage: t.giftCardMessage, giftCardSendOn: t.giftCardSendOn, giftCardNote: t.giftCardNote,
          pickupDay: t.pickupDay, deliveryDay: t.deliveryDay, savedAddresses: t.savedAddresses, newAddress: t.newAddress,
        }}
        giftCardDays={quote.items.some((i) => i.giftCard) ? { min: new Date().toISOString().slice(0, 10), max: new Date(Date.now() + GIFT_CARD_SEND_DAYS * 86_400_000).toISOString().slice(0, 10) } : null}
        taxLabel={exempt ? t.taxExempt : quote.pricesIncludeTax ? t.taxIncluded : t.taxNextStep}
        totalLabel={exempt || quote.pricesIncludeTax ? t.total : t.totalBeforeTax}
        totalWithoutShipping={money(withoutShipping.totalMinor)}
        currency={fx.currency}
        protection={protectionMinor ? { checkbox: t.protectDelivery(money(convertAmount(protectionMinor, fx))), note: t.protectionNote, summary: t.protection, priceLabel: money(convertAmount(protectionMinor, fx)), priceMinor: convertAmount(protectionMinor, fx) } : null}
        giftWrap={hasGoods && shop.giftWrap ? {
          checkbox: shop.giftWrap.priceMinor ? t.giftWrapFor(money(convertAmount(shop.giftWrap.priceMinor, fx))) : t.giftWrapFree, note: shop.giftWrap.note, summary: t.giftWrap,
          priceLabel: shop.giftWrap.priceMinor ? money(convertAmount(shop.giftWrap.priceMinor, fx)) : t.free, priceMinor: convertAmount(shop.giftWrap.priceMinor, fx),
        } : null}
        tips={hasGoods && shop.tipping ? {
          heading: t.tipHeading, none: t.tipNone, summary: t.tip, note: shop.tipping.note,
          options: shop.tipping.percents.map((percent) => {
            const priceMinor = convertAmount(tipAmount(quote.goodsMinor - quote.discountMinor, percent), fx);
            return { percent, label: `${percent}%`, priceMinor, priceLabel: money(priceMinor) };
          }),
        } : null}
        ageCheck={quote.minAge ? { checkbox: t.ageConfirm(quote.minAge), note: t.ageNote } : null}
        summary={
          <>
            <ul className="flex flex-col gap-2 text-sm">
              {quote.items.map((i) => (
                <li key={i.key} className="flex justify-between gap-3">
                  <span>
                    {titles.get(i.variantId) ?? i.title} <span className="hint">× {i.quantity}</span>
                    {i.personalization && <span className="block hint">{i.personalization.map((p) => `${p.label}: ${p.value}`).join(" · ")}</span>}
                    {i.preorderShipsBy && <span className="block hint">{t.preorderShipsBy(new Intl.DateTimeFormat(lang ?? "en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${i.preorderShipsBy}T12:00:00Z`)))}</span>}
                    {i.priceNote && <span className="block hint">{i.priceNote}</span>}
                  </span>
                  <span className="num">{money(shown.units[i.variantId]! * i.quantity)}</span>
                </li>
              ))}
              {quote.freeGift?.unlocked && (
                <li className="flex justify-between gap-3">
                  <span>{quote.freeGift.title} <span className="hint">× 1</span><span className="block hint">{t.freeGift}</span></span>
                  <span className="num">{t.free}</span>
                </li>
              )}
            </ul>
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 num text-sm border-t border-border pt-3">
              <dt className="hint">{t.subtotal}</dt><dd className="text-right">{money(shown.subtotalMinor)}</dd>
              {(quote.discount || quote.bundle) && shown.discountMinor > 0 && (
                <>
                  <dt className="hint">{quote.discount ? `${t.discount} (${quote.discount.code})` : `${t.bundle} (${quote.bundle!.title})`}</dt><dd className="text-right">−{money(shown.discountMinor)}</dd>
                </>
              )}
            </dl>
          </>
        }
        footer={
          <>
            {offer && (
              <AddonOffer
                action={addAddonAction.bind(null, handle, offer.addon.id)}
                heading={t.addonHeading}
                title={offerTitle}
                pitch={offer.addon.pitch}
                imageUrl={offer.product.imageUrl}
                save={offer.addon.percentOff ? t.addonSave(offer.addon.percentOff) : null}
                optionLabel={t.option}
                choices={offer.variants.map((v) => ({
                  id: v.id,
                  title: v.title,
                  priceLabel: money(convertPrice(v.priceMinor, fx)),
                  wasLabel: v.wasMinor > v.priceMinor ? money(convertPrice(v.wasMinor, fx)) : null,
                }))}
                addLabel={Object.fromEntries(offer.variants.map((v) => [v.id, t.addonAdd(money(convertPrice(v.priceMinor, fx)))]))}
              />
            )}
            {quote.giftCard && (
              <dl className="grid grid-cols-[1fr_auto] gap-y-1 num text-sm">
                <dt className="hint">{t.giftCard} ···· {quote.giftCard.last4}</dt>
                <dd className="text-right">−{money(quote.giftCard.appliedMinor)}{quote.pricesIncludeTax ? "" : "+"}</dd>
                <dd className="col-span-2 hint text-right font-sans">{t.giftCardPays}</dd>
              </dl>
            )}
            {fx.rate !== 1 && <p className="hint text-xs">{t.fxNote(fx.currency)}</p>}
          </>
        }
      />
    </>
  );
}
