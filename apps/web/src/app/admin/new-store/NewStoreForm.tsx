"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { createStoreAction } from "../actions";

const COUNTRIES: [string, string][] = [
  ["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"], ["AT", "Austria"], ["BE", "Belgium"],
  ["BG", "Bulgaria"], ["HR", "Croatia"], ["CY", "Cyprus"], ["CZ", "Czechia"], ["DK", "Denmark"], ["EE", "Estonia"],
  ["FI", "Finland"], ["FR", "France"], ["DE", "Germany"], ["GR", "Greece"], ["HU", "Hungary"], ["IE", "Ireland"],
  ["IT", "Italy"], ["LV", "Latvia"], ["LT", "Lithuania"], ["LU", "Luxembourg"], ["MT", "Malta"], ["NL", "Netherlands"],
  ["PL", "Poland"], ["PT", "Portugal"], ["RO", "Romania"], ["SK", "Slovakia"], ["SI", "Slovenia"], ["ES", "Spain"], ["SE", "Sweden"],
];

export function NewStoreForm() {
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
        <select className="input" id="country" name="country" defaultValue="US">
          {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
        <span className="hint">Sets your currency and tax rules.</span>
      </div>
      <SubmitButton className="btn btn-primary btn-lg" pendingText="Creating store…">Create store</SubmitButton>
    </form>
  );
}
