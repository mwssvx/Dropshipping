"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { checkoutAction } from "../actions";

/** A shipping rate priced for this cart, in the buyer's currency. */
export type RateChoice = { id: string; name: string; days: string | null; priceLabel: string; totalLabel: string; priceMinor: number };
export type ZoneChoice = { countries: string[]; rates: RateChoice[] };

const zoneFor = (zones: ZoneChoice[], country: string) => zones.find((z) => z.countries.includes(country)) ?? zones.find((z) => z.countries.includes("*"));
const cheapest = (rates: RateChoice[]) => [...rates].sort((a, b) => a.priceMinor - b.priceMinor)[0];

function Field({ id, label, values, ...rest }: { id: string; label: string; values?: Record<string, string> } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      <input className="input" id={id} name={id} defaultValue={values?.[id]} {...rest} />
    </div>
  );
}

type Props = {
  handle: string;
  defaultCountry: string;
  initial?: Record<string, string>;
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
};

/** Checkout form and order summary side by side; the summary follows the shipping the buyer picks. */
export function Checkout({ summary, footer, taxLabel, totalLabel, totalWithoutShipping, ...form }: Props) {
  const initialCountry = form.initial?.country && form.countries.some(([c]) => c === form.initial!.country) ? form.initial.country : form.countries.some(([c]) => c === form.defaultCountry) ? form.defaultCountry : (form.countries[0]?.[0] ?? form.defaultCountry);
  const [country, setCountry] = useState(initialCountry);
  const rates = form.zones ? (zoneFor(form.zones, country)?.rates ?? []) : [];
  const [rateId, setRateId] = useState<string | null>(null);
  const rate = rates.find((r) => r.id === rateId) ?? cheapest(rates);
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 grid gap-10 md:grid-cols-[1fr_340px] items-start">
      <div className="flex flex-col gap-6 min-w-0">
        <h1 className="text-3xl font-bold tracking-tight">Checkout</h1>
        <CheckoutForm {...form} country={country} onCountry={setCountry} rates={rates} rate={rate} onRate={setRateId} />
      </div>
      <aside className="card p-5 flex flex-col gap-4 md:sticky md:top-6 bg-sunken border-0">
        <h2 className="font-semibold">Order summary</h2>
        {summary}
        <dl className="grid grid-cols-[1fr_auto] gap-y-1 num text-sm -mt-3">
          {form.zones && (
            <>
              <dt className="hint">Shipping{rate ? ` (${rate.name})` : ""}</dt>
              <dd className="text-right">{rate ? rate.priceLabel : "Not available"}</dd>
            </>
          )}
          <dt className="hint">Tax</dt><dd className="text-right hint">{taxLabel}</dd>
          <dt className="font-semibold text-base">{totalLabel}</dt>
          <dd className="font-semibold text-base text-right">{form.zones ? (rate?.totalLabel ?? "–") : totalWithoutShipping}</dd>
        </dl>
        {footer}
      </aside>
    </main>
  );
}

function CheckoutForm({
  handle, initial, paidByGiftCard, countries, zones, country, onCountry, rates, rate, onRate,
}: Omit<Props, "summary" | "footer" | "taxLabel" | "totalLabel" | "totalWithoutShipping" | "defaultCountry"> & {
  country: string;
  onCountry: (c: string) => void;
  rates: RateChoice[];
  rate: RateChoice | undefined;
  onRate: (id: string) => void;
}) {
  const [state, action] = useActionState(checkoutAction.bind(null, handle), {});
  const v = state.values ?? initial;
  return (
    <form action={action} className="flex flex-col gap-6">
      <FormError message={state.error} />
      <fieldset className="flex flex-col gap-4">
        <legend className="font-semibold mb-2">Contact</legend>
        <Field id="email" label="Email" type="email" autoComplete="email" required values={v} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="acceptsMarketing" defaultChecked={v?.acceptsMarketing === "on"} />
          Send me news and offers
        </label>
      </fieldset>
      <fieldset className="flex flex-col gap-4">
        <legend className="font-semibold mb-2">Delivery</legend>
        <Field id="name" label="Full name" autoComplete="name" required values={v} />
        <Field id="line1" label="Address" autoComplete="address-line1" required values={v} />
        <Field id="line2" label="Apartment, suite (optional)" autoComplete="address-line2" values={v} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="city" label="City" autoComplete="address-level2" required values={v} />
          <Field id="region" label="State or region" autoComplete="address-level1" values={v} />
          <Field id="postalCode" label="Postal code" autoComplete="postal-code" required values={v} />
        </div>
        <div className="field">
          <label className="label" htmlFor="country">Country</label>
          <select className="input" id="country" name="country" value={country} onChange={(e) => onCountry(e.target.value)} autoComplete="country">
            {countries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </div>
      </fieldset>
      {zones && (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold mb-2">Shipping</legend>
          {rates.length === 0 ? (
            <p className="banner banner-warning" role="status">This store doesn&apos;t ship to that country yet.</p>
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
      <SubmitButton className="btn btn-primary btn-lg" pendingText="Continuing…">{paidByGiftCard ? "Place order" : "Continue to payment"}</SubmitButton>
    </form>
  );
}
