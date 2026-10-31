import { countryName, describeRate, EVERYWHERE_ELSE, formatDeliveryWindow, formatMoney, listShippingZones, sampleProduct, productDelivery, rateDays, rateWeight, SHIPPING_COUNTRIES, CUTOFF_TIME_ZONES, defaultCutoffZone, HOLIDAY_DAYS_AHEAD, LATE_ORDER_DAYS, LATE_ORDER_MESSAGE_MAX, HANDOVER_DAYS_AHEAD, HANDOVER_LEAD_MAX, SHIP_PAUSE_MAX_DAYS } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { setCheckoutPhoneAction } from "../../shipping-actions";
import { DeliveryEstimatesForm } from "./DeliveryEstimatesForm";
import { DeliveryProtectionForm } from "./DeliveryProtectionForm";
import { ShipCutoffForm } from "./ShipCutoffForm";
import { HolidayDeadlineForm } from "./HolidayDeadlineForm";
import { ShipPauseForm } from "./ShipPauseForm";
import { LateOrderForm } from "./LateOrderForm";
import { GiftWrapForm } from "./GiftWrapForm";
import { LocalDeliveryForm } from "./LocalDeliveryForm";
import { LocalPickupForm } from "./LocalPickupForm";
import { HandoverDaysForm } from "./HandoverDaysForm";
import { MinOrderForm } from "./MinOrderForm";
import { DeleteButton, RateForm, StarterButton, ZoneForm, type Country } from "./ShippingForms";

export const metadata = { title: "Shipping" };

const PHONE_CHOICES = [
  ["optional", "Ask for it, but buyers can leave it empty"],
  ["required", "Buyers must enter one"],
  ["off", "Don't ask"],
] as const;

export default async function ShippingPage() {
  const { shop, db } = await requireShop("shipping");
  const { zones, isDefault } = await listShippingZones(db, shop.id);
  // An example from the store's own catalog, so the merchant sees what buyers see.
  const example = await sampleProduct(db, shop.id);
  const preview = example ? await productDelivery(db, shop, example.id) : null;
  const dayAfter = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const holidayDays = { min: dayAfter(1), max: dayAfter(HOLIDAY_DAYS_AHEAD) };
  const money = (m: number) => formatMoney(m, shop.currency);
  const symbol = money(0).replace(/[\d.,\s]/g, "");
  const all = [EVERYWHERE_ELSE, ...[...SHIPPING_COUNTRIES].sort((a, b) => countryName(a).localeCompare(countryName(b)))];
  // A country can be in one zone only, so the picker greys out ones another zone has.
  const countriesFor = (zoneId?: string): Country[] =>
    all.map((code) => ({ code, name: countryName(code), takenBy: isDefault ? null : (zones.find((z) => z.id !== zoneId && z.countries.includes(code))?.name ?? null) }));
  return (
    <main className="pb-12">
      <PageHeader title="Shipping" />
      <div className="px-4 sm:px-8 flex flex-col gap-4 max-w-3xl">
        <p className="hint">
          Group countries into zones and give each zone one or more rates. Buyers pick a rate at checkout, and countries in no zone can&apos;t check out.
          Gift cards never pay shipping.
        </p>
        {isDefault ? (
          <section className="card p-5 flex flex-col gap-3" aria-labelledby="default-heading">
            <h2 id="default-heading" className="font-semibold">You use the standard rate</h2>
            <p className="text-sm">
              {describeRate(zones[0]!.rates[0]!, shop.currency)}, to every country. Set up zones to charge by country and add a faster option. You get two to start
              from: {countryName(shop.country)} (Standard and Express) and International.
            </p>
            <StarterButton />
          </section>
        ) : (
          <ul className="flex flex-col gap-4">
            {zones.map((z) => (
              <li key={z.id} className="card p-5 flex flex-col gap-4" aria-label={`${z.name} zone`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{z.name}</h2>
                    <p className="text-sm hint">{z.countries.map(countryName).join(", ")}</p>
                  </div>
                  <DeleteButton kind="zone" id={z.id} label={`Delete ${z.name} zone`} />
                </div>
                {z.rates.length === 0 ? (
                  <p className="banner banner-warning text-sm">No rates yet, so buyers in these countries can&apos;t check out.</p>
                ) : (
                  <ul className="divide-y divide-border border-y border-border">
                    {z.rates.map((r) => (
                      <li key={r.id} className="py-2 flex flex-wrap items-center justify-between gap-3 text-sm" aria-label={`${z.name}: ${r.name}`}>
                        <span>
                          <span className="font-medium">{r.name}</span>
                          {rateDays(r) && <span className="hint"> · {rateDays(r)}</span>}
                          {rateWeight(r) && <span className="hint"> · orders {rateWeight(r)}</span>}
                        </span>
                        <span className="flex items-center gap-3">
                          <span className="num">
                            {r.priceMinor ? money(r.priceMinor) : "Free"}
                            {r.priceMinor > 0 && r.freeOverMinor !== null && <span className="hint"> · free over {money(r.freeOverMinor)}</span>}
                          </span>
                          <DeleteButton kind="rate" id={r.id} label={`Remove ${r.name} from ${z.name}`} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <details>
                  <summary className="cursor-pointer text-sm font-medium">Add a rate</summary>
                  <div className="pt-3"><RateForm zoneId={z.id} currencySymbol={symbol} /></div>
                </details>
                <details>
                  <summary className="cursor-pointer text-sm font-medium">Edit name and countries</summary>
                  <div className="pt-3"><ZoneForm countries={countriesFor(z.id)} zone={z} /></div>
                </details>
              </li>
            ))}
          </ul>
        )}
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="delivery-heading">
          <h2 id="delivery-heading" className="font-semibold">Delivery dates</h2>
          <p className="text-sm">
            Product pages show when an order placed today would arrive, and order pages and receipts show the expected delivery. It&apos;s your
            processing days plus days in transit. For transit we use whichever is slower, the supplier&apos;s estimate or your rate&apos;s days, so
            you never promise faster than the supplier ships.
          </p>
          <DeliveryEstimatesForm enabled={shop.deliveryEstimates} processingDays={shop.processingDays} />
          <div className="border-t border-border pt-3 flex flex-col gap-2">
            <h3 id="cutoff-heading" className="font-medium">Same-day cutoff</h3>
            <p className="text-sm hint">
              If you pack orders yourself, or your supplier ships the same day, say what time orders must be in by. Product pages count
              down to it (&quot;Order within 2 h 14 min and it ships today&quot;), and later orders start the next shipping day. Processing days
              count shipping days only.
            </p>
            <ShipCutoffForm cutoff={shop.shipCutoff} zones={CUTOFF_TIME_ZONES} defaultZone={defaultCutoffZone(shop.country)} />
          </div>
          <div className="border-t border-border pt-3 flex flex-col gap-2">
            <h3 id="holiday-heading" className="font-medium">Holiday order-by date</h3>
            <p className="text-sm hint">
              Before a holiday, product pages can say the last day to order (&quot;Order by Dec 15 to get it in time for Christmas&quot;),
              counted back from the slowest delivery date they show. After that day they say an order may not arrive in time, and once the
              holiday has passed the line goes away by itself.
            </p>
            <HolidayDeadlineForm deadline={shop.holidayDeadline} days={holidayDays} />
          </div>
          <div className="border-t border-border pt-3 flex flex-col gap-2">
            <h3 id="pause-heading" className="font-medium">Shipping pause</h3>
            <p className="text-sm hint">
              Your supplier is closed for New Year, or you&apos;re away with your own stock, but you&apos;d rather keep selling. Every store page
              says when orders ship again, delivery dates count from that day, and running late emails wait. It ends by itself. To stop
              taking orders instead, put the store on a break under Store status.
            </p>
            <ShipPauseForm pause={shop.shipPause} today={new Date().toISOString().slice(0, 10)} max={SHIP_PAUSE_MAX_DAYS} />
          </div>
          <div className="border-t border-border pt-3 flex flex-col gap-2">
            <h3 id="late-heading" className="font-medium">Orders running late</h3>
            <p className="text-sm hint">
              When an order still hasn&apos;t shipped some days after paying, the buyer gets one email saying it hasn&apos;t been forgotten and
              that tracking follows as soon as it ships, before they start to worry or open a dispute. Orders on hold, pre-orders, local pickup
              and local delivery are left out, and it shows on the order&apos;s timeline.
            </p>
            <LateOrderForm notice={shop.lateOrderNotice} days={LATE_ORDER_DAYS} max={LATE_ORDER_MESSAGE_MAX} />
          </div>
          {example && (
            <p className="text-sm border-t border-border pt-3" role="note">
              {preview
                ? <>
                    Today, {example.title} shows <strong>{formatDeliveryWindow(preview)}</strong> to {countryName(preview.country)}.
                    {preview.holiday && (preview.holiday.orderBy
                      ? <> Order by <strong>{formatDeliveryWindow({ from: preview.holiday.orderBy, to: preview.holiday.orderBy })}</strong> for {preview.holiday.name}.</>
                      : <> It&apos;s too late to order it for {preview.holiday.name}.</>)}
                  </>
                : shop.deliveryEstimates
                  ? `${example.title} shows no date: its supplier doesn't say how long shipping takes and the rate has no days. Add days to the rate to show one.`
                  : "Delivery dates are off."}
            </p>
          )}
        </section>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="min-order-heading" id="min-order">
          <h2 id="min-order-heading" className="font-semibold">Smallest order</h2>
          <p className="text-sm">
            A very small order can cost more to pack and send than it earns. Set the least a buyer can spend and the cart asks them to add a little more
            before checkout. It counts what they pay for goods after discounts. Gift cards on their own, wholesale orders and payment links you send
            aren&apos;t held to it. Leave it empty to take any amount.
          </p>
          <MinOrderForm
            min={shop.minOrderMinor ? (shop.minOrderMinor / 100).toFixed(2) : ""}
            symbol={new Intl.NumberFormat("en-US", { style: "currency", currency: shop.currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? ""}
          />
        </section>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="phone-heading">
          <h2 id="phone-heading" className="font-semibold">Phone number at checkout</h2>
          <p className="text-sm">
            Couriers call or text when they can&apos;t find an address, and some countries&apos; carriers need a number to deliver at all.
            The number goes to your supplier with the order and shows on the order page. It&apos;s never used for marketing.
          </p>
          <form action={setCheckoutPhoneAction} className="flex flex-col gap-2 text-sm">
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Ask for a phone number</legend>
              {PHONE_CHOICES.map(([value, label]) => (
                <label key={value} className="flex items-center gap-2">
                  <input type="radio" name="checkoutPhone" value={value} defaultChecked={shop.checkoutPhone === value} />
                  {label}
                </label>
              ))}
            </fieldset>
            <button className="btn btn-secondary self-start">Save</button>
          </form>
        </section>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="protection-heading" id="protection">
          <h2 id="protection-heading" className="font-semibold">Delivery protection</h2>
          <p className="text-sm">
            Buyers can pay a little extra at checkout to protect their parcel. If a protected order is lost or arrives damaged, send it again for free
            with Send a replacement on the order page. What they pay is yours and helps cover those replacements. It&apos;s never ticked for them.
          </p>
          <DeliveryProtectionForm
            protection={shop.deliveryProtection}
            symbol={new Intl.NumberFormat("en-US", { style: "currency", currency: shop.currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? ""}
          />
        </section>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="gift-wrap-heading" id="gift-wrap">
          <h2 id="gift-wrap-heading" className="font-semibold">Gift wrapping</h2>
          <p className="text-sm">
            Buyers who tick &quot;This order is a gift&quot; can have it wrapped for your price. What they pay is yours. Wrapped orders are marked on the order
            page and on the packing slip. If a supplier ships the item, check they can wrap it before you turn this on.
          </p>
          <GiftWrapForm
            wrap={shop.giftWrap}
            symbol={new Intl.NumberFormat("en-US", { style: "currency", currency: shop.currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? ""}
          />
        </section>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="pickup-heading" id="pickup">
          <h2 id="pickup-heading" className="font-semibold">Local pickup</h2>
          <p className="text-sm">
            Buyers in {countryName(shop.country)} can choose to collect their order from you for free instead of paying for shipping. It&apos;s offered when
            everything in the cart is your own stock, since supplier items ship from the supplier. Press Ready for pickup on the order when it&apos;s packed,
            and Picked up when they have it.
          </p>
          <LocalPickupForm pickup={shop.localPickup} />
        </section>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="local-delivery-heading" id="local-delivery">
          <h2 id="local-delivery-heading" className="font-semibold">Local delivery</h2>
          <p className="text-sm">
            Drop orders off yourself to buyers nearby, for your own price. Buyers see it at checkout once their postal code is in your area and everything in the
            cart is your own stock. Press Delivered on the order when it&apos;s at their door.
          </p>
          <LocalDeliveryForm
            area={shop.localDeliveryArea}
            symbol={new Intl.NumberFormat("en-US", { style: "currency", currency: shop.currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? ""}
          />
        </section>
        {(shop.localPickup || shop.localDeliveryArea || shop.handoverDays) && (
          <section className="card p-5 flex flex-col gap-3" aria-labelledby="handover-heading" id="handover">
            <h2 id="handover-heading" className="font-semibold">Pickup and delivery days</h2>
            <p className="text-sm">
              Let buyers who collect their order or get it from you pick the day at checkout, from the next {HANDOVER_DAYS_AHEAD} days you&apos;re open.
              The day shows on the order, for you and for them, so nobody waits on a closed shop, and buyers get a reminder email the day before.
            </p>
            <HandoverDaysForm days={shop.handoverDays} zones={CUTOFF_TIME_ZONES} defaultZone={shop.shipCutoff?.timeZone ?? defaultCutoffZone(shop.country)} maxLead={HANDOVER_LEAD_MAX} />
          </section>
        )}
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="new-zone">
          <h2 id="new-zone" className="font-semibold">Add a zone</h2>
          {isDefault && <p className="text-sm hint">Your first zone replaces the standard rate: after that, only countries in a zone can check out.</p>}
          <ZoneForm countries={countriesFor()} />
        </section>
      </div>
    </main>
  );
}
