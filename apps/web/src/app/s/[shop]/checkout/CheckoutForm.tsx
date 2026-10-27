"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { checkoutAction } from "../actions";

/** A shipping rate priced for this cart, in the buyer's currency. */
export type RateChoice = { id: string; name: string; days: string | null; priceLabel: string; totalLabel: string; priceMinor: number; protectedTotalLabel?: string; pickup?: boolean };
/** Delivery protection the buyer can add, priced for this cart in their currency. */
export type ProtectionChoice = { checkbox: string; note: string; summary: string; priceLabel: string };
export type ZoneChoice = { countries: string[]; rates: RateChoice[] };

const zoneFor = (zones: ZoneChoice[], country: string) => zones.find((z) => z.countries.includes(country)) ?? zones.find((z) => z.countries.includes("*"));
// Picking up is free, so it would always be cheapest: it's only ever chosen.
const cheapest = (rates: RateChoice[]) => [...rates].filter((r) => !r.pickup).sort((a, b) => a.priceMinor - b.priceMinor)[0] ?? rates[0];

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
  | "giftCheckbox" | "giftFrom" | "giftMessage" | "giftRecipientEmail" | "giftNote" | "orderNote",
  string
>;

type Props = {
  handle: string;
  text: CheckoutText;
  defaultCountry: string;
  initial?: Record<string, string>;
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
  protection?: ProtectionChoice | null;
};

/** Checkout form and order summary side by side; the summary follows the shipping the buyer picks. */
export function Checkout({ summary, footer, taxLabel, totalLabel, totalWithoutShipping, ...form }: Props) {
  const t = form.text;
  const initialCountry = form.initial?.country && form.countries.some(([c]) => c === form.initial!.country) ? form.initial.country : form.countries.some(([c]) => c === form.defaultCountry) ? form.defaultCountry : (form.countries[0]?.[0] ?? form.defaultCountry);
  const [country, setCountry] = useState(initialCountry);
  const rates = form.zones ? (zoneFor(form.zones, country)?.rates ?? []) : [];
  const [rateId, setRateId] = useState<string | null>(null);
  const rate = rates.find((r) => r.id === rateId) ?? cheapest(rates);
  const [protect, setProtect] = useState(false);
  // Nothing travels when it's picked up, so there's nothing to protect.
  const protecting = protect && !!form.protection && !rate?.pickup;
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 grid gap-10 md:grid-cols-[1fr_340px] items-start">
      <div className="flex flex-col gap-6 min-w-0">
        <h1 className="text-3xl font-bold tracking-tight">{t.checkout}</h1>
        <CheckoutForm {...form} country={country} onCountry={setCountry} rates={rates} rate={rate} onRate={setRateId} protect={protect} onProtect={setProtect} />
      </div>
      <aside className="card p-5 flex flex-col gap-4 md:sticky md:top-6 bg-sunken border-0">
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
          <dt className="hint">{t.tax}</dt><dd className="text-right hint">{taxLabel}</dd>
          <dt className="font-semibold text-base">{totalLabel}</dt>
          <dd className="font-semibold text-base text-right">{form.zones ? ((protecting ? rate?.protectedTotalLabel : rate?.totalLabel) ?? "–") : totalWithoutShipping}</dd>
        </dl>
        {footer}
      </aside>
    </main>
  );
}

function CheckoutForm({
  handle, text: t, initial, askPhone, paidByGiftCard, countries, zones, country, onCountry, rates, rate, onRate, protection, protect, onProtect,
}: Omit<Props, "summary" | "footer" | "taxLabel" | "totalLabel" | "totalWithoutShipping" | "defaultCountry"> & {
  country: string;
  onCountry: (c: string) => void;
  rates: RateChoice[];
  rate: RateChoice | undefined;
  onRate: (id: string) => void;
  protect: boolean;
  onProtect: (on: boolean) => void;
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
        <Field id="name" label={t.fullName} autoComplete="name" required values={v} />
        <Field id="line1" label={t.address} autoComplete="address-line1" required values={v} />
        <Field id="line2" label={t.address2} autoComplete="address-line2" values={v} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="city" label={t.city} autoComplete="address-level2" required values={v} />
          <Field id="region" label={t.region} autoComplete="address-level1" values={v} />
          <Field id="postalCode" label={t.postalCode} autoComplete="postal-code" required values={v} />
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
        </fieldset>
      )}
      {zones && protection && !rate?.pickup && (
        <label className="card p-3 flex items-start gap-3 cursor-pointer">
          <input type="checkbox" name="protection" className="mt-1" checked={protect} onChange={(e) => onProtect(e.target.checked)} />
          <span className="flex-1">
            <span className="font-medium">{protection.checkbox}</span>
            <span className="block hint text-sm">{protection.note}</span>
          </span>
        </label>
      )}
      {zones && <GiftFields t={t} values={v} />}
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

/** "This order is a gift": who it's from, a message, and the recipient's email for a heads-up. */
function GiftFields({ t, values }: { t: CheckoutText; values?: Record<string, string> }) {
  const [gift, setGift] = useState(values?.gift === "on");
  return (
    <fieldset className="flex flex-col gap-4">
      <label className="flex items-center gap-2">
        <input type="checkbox" name="gift" checked={gift} onChange={(e) => setGift(e.target.checked)} />
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
        </>
      )}
    </fieldset>
  );
}
