"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { checkoutAction } from "../actions";

const COUNTRIES: [string, string][] = [["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"], ["DE", "Germany"], ["FR", "France"], ["ES", "Spain"], ["IT", "Italy"], ["NL", "Netherlands"], ["IE", "Ireland"], ["SE", "Sweden"], ["PL", "Poland"]];

function Field({ id, label, values, ...rest }: { id: string; label: string; values?: Record<string, string> } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      <input className="input" id={id} name={id} defaultValue={values?.[id]} {...rest} />
    </div>
  );
}

export function CheckoutForm({ handle, defaultCountry, initial }: { handle: string; defaultCountry: string; initial?: Record<string, string> }) {
  const [state, action] = useActionState(checkoutAction.bind(null, handle), {});
  const v = state.values ?? initial;
  return (
    <form action={action} className="flex flex-col gap-6">
      <FormError message={state.error} />
      <fieldset className="flex flex-col gap-4">
        <legend className="font-semibold mb-2">Contact</legend>
        <Field id="email" label="Email" type="email" autoComplete="email" required values={v} />
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
          <select className="input" id="country" name="country" defaultValue={v?.country ?? defaultCountry} autoComplete="country">
            {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </div>
      </fieldset>
      <SubmitButton className="btn btn-primary btn-lg" pendingText="Continuing…">Continue to payment</SubmitButton>
    </form>
  );
}
