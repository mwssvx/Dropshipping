"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { createStoreAction } from "../actions";

export function NewStoreForm({ countries }: { countries: { code: string; name: string; crossBorder: boolean }[] }) {
  const [country, setCountry] = useState("US");
  const chosen = countries.find((c) => c.code === country);
  const [state, action] = useActionState(createStoreAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError message={state.error} />
      <div className="field">
        <label className="label" htmlFor="name">Store name</label>
        <input className="input" id="name" name="name" required minLength={2} maxLength={80} placeholder="Glow Lamps" />
      </div>
      <div className="field">
        <label className="label" htmlFor="country">Where your business is based</label>
        <select className="input" id="country" name="country" value={country} onChange={(e) => setCountry(e.target.value)}>
          {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <span className="hint">Sets your currency, tax rules and how you get paid. Buyers can be anywhere your supplier ships.</span>
        {chosen?.crossBorder && (
          <span className="hint" role="status">
            Stores in {chosen.name} sell in US dollars, and Stripe pays your money to your local bank.
          </span>
        )}
      </div>
      <SubmitButton className="btn btn-primary btn-lg" pendingText="Creating store…">Create store</SubmitButton>
    </form>
  );
}
