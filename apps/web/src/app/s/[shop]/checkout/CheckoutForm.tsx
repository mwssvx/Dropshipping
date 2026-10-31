"use client";
import { startTransition, useActionState, useState } from "react";
import { formatMoney } from "@sf/core/money";
import { FormError } from "@/components/FormError";
import { checkoutAction } from "../actions";

/** A shipping rate priced for this cart, in the buyer's currency. */
export type RateChoice = {
  id: string; name: string; days: string | null; priceLabel: string; priceMinor: number; totalMinor: number; pickup?: boolean; postalPrefixes?: string[];
  /** The days the buyer can pick for a pickup or local delivery ([YYYY-MM-DD, label]), where the store lets them choose. */
  dates?: [string, string][];
};
/** Delivery protection or gift wrapping the buyer can add, priced for this cart in their currency. */
export type ExtraChoice = { checkbox: string; note: string | null; summary: string; priceLabel: string; priceMinor: number };
/** Tips the buyer can add: each percentage with what it comes to in their currency. */
export type TipChoice = { heading: string; none: string; summary: string; note: string | null; options: { percent: number; label: string; priceMinor: number; priceLabel: string }[] };
export type ZoneChoice = { countries: string[]; rates: RateChoice[] };

const zoneFor = (zones: ZoneChoice[], country: string) => zones.find((z) => z.countries.includes(country)) ?? zones.find((z) => z.countries.includes("*"));
// Picking up and the store's own delivery are only ever chosen, never picked as the cheapest.
const cheapest = (rates: RateChoice[]) => [...rates].filter((r) => !r.pickup && !r.postalPrefixes).sort((a, b) => a.priceMinor - b.priceMinor)[0] ?? rates[0];
/** The store's own delivery shows once the postal code is in its area (compared as core's postalKey does). */
const servesPostal = (r: RateChoice, postal: string) => {
  if (!r.postalPrefixes) return true;
  const key = postal.toUpperCase().replace(/[\s-]/g, "");
  return !!key && r.postalPrefixes.some((p) => key.startsWith(p));
};

function Field({ id, label, values, ...rest }: { id: string; label: string; values?: Record<string, string> } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      <input className="input" id={id} name={id} defaultValue={values?.[id]} {...rest} />
    </div>
  );
}

/** The checkout's words in the buyer's language. */
export type CheckoutText = Record<
  | "checkout" | "orderSummary" | "contact" | "newsAndOffers" | "delivery" | "email" | "fullName" | "address" | "address2" | "city" | "region" | "phone"
  | "postalCode" | "country" | "shipping" | "noShipping" | "placeOrder" | "continueToPayment" | "continuing" | "notAvailable" | "tax"
  | "giftCheckbox" | "giftFrom" | "giftMessage" | "giftRecipientEmail" | "giftNote" | "orderNote"
  | "giftCardTo" | "giftCardEmail" | "giftCardName" | "giftCardFrom" | "giftCardMessage" | "giftCardSendOn" | "giftCardNote" | "pickupDay" | "deliveryDay" | "savedAddresses" | "newAddress",
  string
>;

type Props = {
  handle: string;
  text: CheckoutText;
  defaultCountry: string;
  initial?: Record<string, string>;
  /** Import duties for orders abroad: the countries a note shows for, and the note with "{country}" in it. */
  duties?: { countries: string[]; note: string } | null;
  /** "Comes in 2 parcels…", when the cart comes from more than one supplier or warehouse. */
  parcelsNote?: string | null;
  /** A signed-in buyer's past addresses, newest first, each as form values with a one-line label. */
  addresses?: { label: string; values: Record<string, string> }[];
  /** Whether the store asks for a phone number for the courier. */
  askPhone: "off" | "optional" | "required";
  paidByGiftCard?: boolean;
  countries: [string, string][];
  /** Null when nothing in the cart ships (only gift cards). */
  zones: ZoneChoice[] | null;
  /** The order summary: items and subtotal rows rendered on the server. */
  summary: React.ReactNode;
  /** Gift card rows and notes under the total. */
  footer?: React.ReactNode;
  taxLabel: string;
  totalLabel: string;
  /** Total with no shipping, for carts with nothing to ship. */
  totalWithoutShipping: string;
  /** Null when the store doesn't offer delivery protection, or nothing ships. */
  protection?: ExtraChoice | null;
  /** Null when the store doesn't gift wrap, or nothing ships. */
  giftWrap?: ExtraChoice | null;
  /** The "I'm old enough" box and its note, when something in the cart has a minimum age. */
  ageCheck?: { checkbox: string; note: string } | null;
  /** The days a gift card in the cart can be sent on ("2026-10-28"), or null when there's none. */
  giftCardDays?: { min: string; max: string } | null;
  /** Null when the store doesn't ask for tips, or nothing ships. */
  tips?: TipChoice | null;
  /** The buyer's currency, for the total as it changes. */
  currency: string;
};

/** Checkout form and order summary side by side; the summary follows the shipping the buyer picks. */
export function Checkout({ summary, footer, taxLabel, totalLabel, totalWithoutShipping, ...form }: Props) {
  const t = form.text;
  const initialCountry = form.initial?.country && form.countries.some(([c]) => c === form.initial!.country) ? form.initial.country : form.countries.some(([c]) => c === form.defaultCountry) ? form.defaultCountry : (form.countries[0]?.[0] ?? form.defaultCountry);
  const [country, setCountry] = useState(initialCountry);
  const [postal, setPostal] = useState(form.initial?.postalCode ?? "");
  const rates = form.zones ? (zoneFor(form.zones, country)?.rates ?? []).filter((r) => servesPostal(r, postal)) : [];
  const [rateId, setRateId] = useState<string | null>(null);
  const rate = rates.find((r) => r.id === rateId) ?? cheapest(rates);
  const [protect, setProtect] = useState(false);
  // Nothing goes by courier when it's picked up or the store delivers it, so there's nothing to protect.
  const protecting = protect && !!form.protection && !rate?.pickup && !rate?.postalPrefixes;
  const [gift, setGift] = useState(form.initial?.gift === "on");
  const [wrap, setWrap] = useState(false);
  const wrapping = gift && wrap && !!form.giftWrap;
  const [tipPercent, setTipPercent] = useState(0);
  const tip = form.tips?.options.find((o) => o.percent === tipPercent) ?? null;
  const total = rate ? rate.totalMinor + (protecting ? form.protection!.priceMinor : 0) + (wrapping ? form.giftWrap!.priceMinor : 0) + (tip?.priceMinor ?? 0) : null;
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 grid gap-10 md:grid-cols-[1fr_340px] items-start">
      <div className="flex flex-col gap-6 min-w-0">
        <h1 className="text-3xl font-bold tracking-tight">{t.checkout}</h1>
        <CheckoutForm {...form} country={country} onCountry={setCountry} onPostal={setPostal} rates={rates} rate={rate} onRate={setRateId} protect={protect} onProtect={setProtect} gift={gift} onGift={setGift} wrap={wrap} onWrap={setWrap} tipPercent={tipPercent} onTip={setTipPercent} />
      </div>
      <aside className="card p-5 flex flex-col gap-4 md:sticky md:top-[calc(var(--sticky-offset,0px)+1.5rem)] bg-sunken border-0">
        <h2 className="font-semibold">{t.orderSummary}</h2>
        {summary}
        <dl className="grid grid-cols-[1fr_auto] gap-y-1 num text-sm -mt-3">
          {form.zones && (
            <>
              <dt className="hint">{t.shipping}{rate ? ` (${rate.name})` : ""}</dt>
              <dd className="text-right">{rate ? rate.priceLabel : t.notAvailable}</dd>
            </>
          )}
          {protecting && (
            <>
              <dt className="hint">{form.protection!.summary}</dt>
              <dd className="text-right">{form.protection!.priceLabel}</dd>
            </>
          )}
          {wrapping && (
            <>
              <dt className="hint">{form.giftWrap!.summary}</dt>
              <dd className="text-right">{form.giftWrap!.priceLabel}</dd>
            </>
          )}
          {tip && (
            <>
              <dt className="hint">{form.tips!.summary}</dt>
              <dd className="text-right">{tip.priceLabel}</dd>
            </>
          )}
          <dt className="hint">{t.tax}</dt><dd className="text-right hint">{taxLabel}</dd>
          <dt className="font-semibold text-base">{totalLabel}</dt>
          <dd className="font-semibold text-base text-right">{form.zones ? (total !== null ? formatMoney(total, form.currency) : "–") : totalWithoutShipping}</dd>
        </dl>
        {footer}
      </aside>
    </main>
  );
}

function CheckoutForm({
  handle, text: t, initial, addresses, duties, parcelsNote, askPhone, paidByGiftCard, countries, zones, country, onCountry, onPostal, rates, rate, onRate, protection, protect, onProtect, giftWrap, ageCheck, gift, onGift, wrap, onWrap, tips, tipPercent, onTip, giftCardDays,
}: Omit<Props, "summary" | "footer" | "taxLabel" | "totalLabel" | "totalWithoutShipping" | "defaultCountry" | "currency"> & {
  country: string;
  onCountry: (c: string) => void;
  onPostal: (code: string) => void;
  rates: RateChoice[];
  rate: RateChoice | undefined;
  onRate: (id: string) => void;
  protect: boolean;
  onProtect: (on: boolean) => void;
  gift: boolean;
  onGift: (on: boolean) => void;
  wrap: boolean;
  onWrap: (on: boolean) => void;
  tipPercent: number;
  onTip: (percent: number) => void;
}) {
  const [state, action, pending] = useActionState(checkoutAction.bind(null, handle), {});
  const v = state.values ?? initial;
  return (
    // Submitted by hand: React resets a form after its action, which would put the country back
    // to the first in the list while the page still prices the one the buyer picked.
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      <fieldset className="flex flex-col gap-4">
        <legend className="font-semibold mb-2">{t.contact}</legend>
        <Field id="email" label={t.email} type="email" autoComplete="email" required values={v} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="acceptsMarketing" defaultChecked={v?.acceptsMarketing === "on"} />
          {t.newsAndOffers}
        </label>
      </fieldset>
      <fieldset className="flex flex-col gap-4">
        <legend className="font-semibold mb-2">{t.delivery}</legend>
        {addresses && addresses.length > 1 && (
          <div className="field">
            <label className="label" htmlFor="savedAddress">{t.savedAddresses}</label>
            <select
              className="input"
              id="savedAddress"
              defaultValue="0"
              onChange={(e) => {
                // Fills the fields below; they stay editable, and nothing is sent from this menu itself.
                const picked = addresses[Number(e.target.value)]?.values;
                const f = e.currentTarget.form;
                if (!f) return;
                for (const k of ["name", "line1", "line2", "city", "region", "postalCode", "phone"]) {
                  const input = f.elements.namedItem(k);
                  if (input instanceof HTMLInputElement) input.value = picked?.[k] ?? "";
                }
                if (picked?.country && countries.some(([c]) => c === picked.country)) onCountry(picked.country);
                onPostal(picked?.postalCode ?? "");
              }}
            >
              {addresses.map((a, i) => <option key={i} value={i}>{a.label}</option>)}
              <option value="new">{t.newAddress}</option>
            </select>
          </div>
        )}
        <Field id="name" label={t.fullName} autoComplete="name" required values={v} />
        <Field id="line1" label={t.address} autoComplete="address-line1" required values={v} />
        <Field id="line2" label={t.address2} autoComplete="address-line2" values={v} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="city" label={t.city} autoComplete="address-level2" required values={v} />
          <Field id="region" label={t.region} autoComplete="address-level1" values={v} />
          <Field id="postalCode" label={t.postalCode} autoComplete="postal-code" required values={v} onChange={(e) => onPostal(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="country">{t.country}</label>
          <select className="input" id="country" name="country" value={country} onChange={(e) => onCountry(e.target.value)} autoComplete="country">
            {countries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </div>
        {askPhone !== "off" && zones && (
          <Field id="phone" label={t.phone} type="tel" autoComplete="tel" inputMode="tel" maxLength={30} required={askPhone === "required"} values={v} />
        )}
      </fieldset>
      {zones && (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold mb-2">{t.shipping}</legend>
          {rates.length === 0 ? (
            <p className="banner banner-warning" role="status">{t.noShipping}</p>
          ) : (
            rates.map((r) => (
              <label key={r.id} className={`card p-3 flex items-center gap-3 cursor-pointer ${rate?.id === r.id ? "border-accent" : ""}`}>
                <input type="radio" name="shippingRateId" value={r.id} checked={rate?.id === r.id} onChange={() => onRate(r.id)} />
                <span className="flex-1">
                  <span className="font-medium">{r.name}</span>
                  {r.days && <span className="block hint text-sm">{r.days}</span>}
                </span>
                <span className="num">{r.priceLabel}</span>
              </label>
            ))
          )}
          {duties && duties.countries.includes(country) && !rate?.pickup && !rate?.postalPrefixes && (
            <p className="hint text-sm" id="duties-note">{duties.note.replace("{country}", countries.find(([c]) => c === country)?.[1] ?? country)}</p>
          )}
          {parcelsNote && rates.length > 0 && !rate?.pickup && !rate?.postalPrefixes && <p className="hint text-sm" id="parcels-note">{parcelsNote}</p>}
          {rate?.dates && (
            <div className="field">
              <label className="label" htmlFor="handoverOn">{rate.pickup ? t.pickupDay : t.deliveryDay}</label>
              <select className="input" id="handoverOn" name="handoverOn" required defaultValue={v?.handoverOn && rate.dates.some(([d]) => d === v.handoverOn) ? v.handoverOn : rate.dates[0]?.[0]}>
                {rate.dates.map(([d, label]) => <option key={d} value={d}>{label}</option>)}
              </select>
            </div>
          )}
        </fieldset>
      )}
      {zones && protection && !rate?.pickup && !rate?.postalPrefixes && (
        <label className="card p-3 flex items-start gap-3 cursor-pointer">
          <input type="checkbox" name="protection" className="mt-1" checked={protect} onChange={(e) => onProtect(e.target.checked)} />
          <span className="flex-1">
            <span className="font-medium">{protection.checkbox}</span>
            <span className="block hint text-sm">{protection.note}</span>
          </span>
        </label>
      )}
      {zones && <GiftFields t={t} values={v} gift={gift} onGift={onGift} wrapChoice={giftWrap ?? null} wrap={wrap} onWrap={onWrap} />}
      {giftCardDays && <GiftCardFields t={t} values={v} days={giftCardDays} />}
      {zones && tips && (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold mb-2">{tips.heading}</legend>
          {tips.note && <p className="hint text-sm -mt-1">{tips.note}</p>}
          <div className="flex flex-wrap gap-2">
            {[{ percent: 0, label: tips.none, priceLabel: "" }, ...tips.options].map((o) => (
              <label key={o.percent} className={`card px-3 py-2 flex items-center gap-2 cursor-pointer ${tipPercent === o.percent ? "border-accent" : ""}`}>
                <input type="radio" name="tipPercent" value={o.percent || ""} checked={tipPercent === o.percent} onChange={() => onTip(o.percent)} />
                <span>{o.label}{o.priceLabel && <span className="hint num"> · {o.priceLabel}</span>}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {ageCheck && (
        <label className="card p-3 flex items-start gap-3 cursor-pointer">
          <input type="checkbox" name="ageConfirmed" className="mt-1" required defaultChecked={v?.ageConfirmed === "on"} />
          <span className="flex-1">
            <span className="font-medium">{ageCheck.checkbox}</span>
            <span className="block hint text-sm">{ageCheck.note}</span>
          </span>
        </label>
      )}
      <div className="field">
        <label className="label" htmlFor="note">{t.orderNote}</label>
        <textarea className="input" id="note" name="note" rows={2} maxLength={500} defaultValue={v?.note} />
      </div>
      <button type="submit" className="btn btn-primary btn-lg" disabled={pending} aria-busy={pending}>
        {pending ? t.continuing : paidByGiftCard ? t.placeOrder : t.continueToPayment}
      </button>
    </form>
  );
}

/** "Send the gift card to someone": who gets the code, who it's from, a message and the day it goes out. */
function GiftCardFields({ t, values, days }: { t: CheckoutText; values?: Record<string, string>; days: { min: string; max: string } }) {
  const [on, setOn] = useState(values?.giftCardTo === "on");
  return (
    <fieldset className="flex flex-col gap-4">
      <label className="flex items-center gap-2">
        <input type="checkbox" name="giftCardTo" checked={on} onChange={(e) => setOn(e.target.checked)} />
        <span className="font-semibold">{t.giftCardTo}</span>
      </label>
      {on && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="giftCardEmail" label={t.giftCardEmail} type="email" required values={values} />
            <Field id="giftCardName" label={t.giftCardName} maxLength={60} values={values} />
          </div>
          <Field id="giftCardFrom" label={t.giftCardFrom} autoComplete="name" required maxLength={60} values={values} />
          <div className="field">
            <label className="label" htmlFor="giftCardMessage">{t.giftCardMessage}</label>
            <textarea className="input" id="giftCardMessage" name="giftCardMessage" rows={3} maxLength={300} defaultValue={values?.giftCardMessage} />
          </div>
          <div className="field">
            <label className="label" htmlFor="giftCardSendOn">{t.giftCardSendOn}</label>
            <input className="input" type="date" id="giftCardSendOn" name="giftCardSendOn" min={days.min} max={days.max} defaultValue={values?.giftCardSendOn} />
          </div>
          <p className="hint text-sm">{t.giftCardNote}</p>
        </>
      )}
    </fieldset>
  );
}

/** "This order is a gift": who it's from, a message, and the recipient's email for a heads-up. */
function GiftFields({ t, values, gift, onGift, wrapChoice, wrap, onWrap }: {
  t: CheckoutText; values?: Record<string, string>; gift: boolean; onGift: (on: boolean) => void; wrapChoice: ExtraChoice | null; wrap: boolean; onWrap: (on: boolean) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-4">
      <label className="flex items-center gap-2">
        <input type="checkbox" name="gift" checked={gift} onChange={(e) => onGift(e.target.checked)} />
        <span className="font-semibold">{t.giftCheckbox}</span>
      </label>
      {gift && (
        <>
          <Field id="giftFrom" label={t.giftFrom} autoComplete="name" required maxLength={60} values={values} />
          <div className="field">
            <label className="label" htmlFor="giftMessage">{t.giftMessage}</label>
            <textarea className="input" id="giftMessage" name="giftMessage" rows={3} maxLength={300} defaultValue={values?.giftMessage} />
          </div>
          <Field id="giftRecipientEmail" label={t.giftRecipientEmail} type="email" values={values} />
          <p className="hint text-sm">{t.giftNote}</p>
          {wrapChoice && (
            <label className="card p-3 flex items-start gap-3 cursor-pointer">
              <input type="checkbox" name="giftWrap" className="mt-1" checked={wrap} onChange={(e) => onWrap(e.target.checked)} />
              <span className="flex-1">
                <span className="font-medium">{wrapChoice.checkbox}</span>
                {wrapChoice.note && <span className="block hint text-sm">{wrapChoice.note}</span>}
              </span>
            </label>
          )}
        </>
      )}
    </fieldset>
  );
}
