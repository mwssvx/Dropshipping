"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { createPaymentLinkAction, type LinkState } from "../../../payment-link-actions";

type Choice = { id: string; label: string };

function Field({ id, label, values, ...rest }: { id: string; label: string; values: Record<string, string> } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      <input className="input" id={id} name={id} defaultValue={values[id] ?? ""} {...rest} />
    </div>
  );
}

export function PaymentLinkForm({ variants, countries, defaultCountry }: { variants: Choice[]; countries: [string, string][]; defaultCountry: string }) {
  const [state, action] = useActionState(createPaymentLinkAction, {} as LinkState);
  const v = state.values ?? {};
  const [rows, setRows] = useState(() => (state.lines?.length ? state.lines.length : 1));
  const lines = state.lines ?? [];
  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
      <div className="flex flex-col gap-6 min-w-0">
        <FormError message={state.error} />
        <fieldset className="card p-5 flex flex-col gap-3">
          <legend className="font-semibold px-1">Products</legend>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="grid grid-cols-[1fr_6rem] gap-3 items-end">
              <div className="field">
                <label className="label" htmlFor={`variant-${i}`}>Product {i + 1}</label>
                {/* Keyed by the value so a failed submit's choice comes back (React resets forms after an action). */}
                <select key={lines[i]?.variantId ?? ""} className="input" id={`variant-${i}`} name="variantId" defaultValue={lines[i]?.variantId ?? ""} required={i === 0}>
                  <option value="">Pick a product</option>
                  {variants.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor={`qty-${i}`}>Quantity</label>
                <input className="input num" id={`qty-${i}`} name="quantity" type="number" min={0} max={99} defaultValue={lines[i]?.quantity ?? 1} />
              </div>
            </div>
          ))}
          {rows < 10 && <button type="button" className="btn btn-secondary self-start" onClick={() => setRows(rows + 1)}>Add another product</button>}
          <Field id="discountCode" label="Discount code (optional)" values={v} placeholder="One of your codes, like WELCOME10" />
        </fieldset>
        <fieldset className="card p-5 flex flex-col gap-4">
          <legend className="font-semibold px-1">Customer</legend>
          <Field id="email" label="Email" type="email" required values={v} />
          <Field id="name" label="Full name" required values={v} />
          <Field id="line1" label="Address" required values={v} />
          <Field id="line2" label="Apartment, suite (optional)" values={v} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="city" label="City" required values={v} />
            <Field id="region" label="State or region" values={v} />
            <Field id="postalCode" label="Postal code" required values={v} />
          </div>
          <div className="field">
            <label className="label" htmlFor="country">Country</label>
            <select key={v.country ?? defaultCountry} className="input" id="country" name="country" defaultValue={v.country ?? defaultCountry}>
              {countries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
          </div>
          <Field id="phone" label="Phone for the courier (optional)" type="tel" values={v} />
        </fieldset>
      </div>
      <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
        <section className="card p-4 flex flex-col gap-3">
          <div className="field">
            <label className="label" htmlFor="note">Note to the customer (optional)</label>
            <textarea className="input" id="note" name="note" rows={4} maxLength={1000} defaultValue={v.note ?? ""} placeholder="Thanks for your message! Here's the order we talked about." />
          </div>
          <p className="hint text-sm">
            Prices, shipping and tax are worked out the same way as checkout. We email the customer a link to pay; once they pay it&apos;s an ordinary order.
          </p>
        </section>
        <SubmitButton className="btn btn-primary btn-lg" pendingText="Sending…">Email the payment link</SubmitButton>
      </aside>
    </form>
  );
}
