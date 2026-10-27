"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../actions";
import { addRateAction, createZoneAction, deleteRateAction, deleteZoneAction, starterZonesAction, updateZoneAction } from "../../shipping-actions";

export type Country = { code: string; name: string; takenBy: string | null };

export function StarterButton() {
  const [state, action] = useActionState(starterZonesAction, {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormError message={state.error} />
      <SubmitButton className="btn btn-primary self-start">Set up shipping zones</SubmitButton>
    </form>
  );
}

function CountryPicker({ countries, selected }: { countries: Country[]; selected: string[] }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="label mb-1">Countries</legend>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm max-h-64 overflow-y-auto">
        {countries.map((c) => (
          <label key={c.code} className={`flex items-center gap-2 ${c.takenBy ? "opacity-50" : ""}`} title={c.takenBy ? `In ${c.takenBy}` : undefined}>
            <input type="checkbox" name="countries" value={c.code} defaultChecked={selected.includes(c.code)} disabled={!!c.takenBy} />
            <span className={c.code === "*" ? "font-medium" : ""}>{c.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ZoneForm({ countries, zone }: { countries: Country[]; zone?: { id: string; name: string; countries: string[] } }) {
  const [state, action] = useActionState(zone ? updateZoneAction.bind(null, zone.id) : createZoneAction, {} as FormState);
  return (
    <form key={!zone && state.saved ? Date.now() : "zone"} action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {zone && state.saved && <p className="text-sm text-success" role="status">Saved.</p>}
      <div className="field max-w-sm">
        <label className="label" htmlFor={`zone-name-${zone?.id ?? "new"}`}>Zone name</label>
        <input className="input" id={`zone-name-${zone?.id ?? "new"}`} name="name" defaultValue={zone?.name} placeholder="Europe" required maxLength={60} />
      </div>
      <CountryPicker countries={countries} selected={zone?.countries ?? []} />
      <SubmitButton className="btn btn-secondary self-start">{zone ? "Save zone" : "Add zone"}</SubmitButton>
    </form>
  );
}

export function RateForm({ zoneId, currencySymbol }: { zoneId: string; currencySymbol: string }) {
  const [state, action] = useActionState(addRateAction.bind(null, zoneId), {} as FormState);
  return (
    <form key={state.saved ? Date.now() : "rate"} action={action} className="flex flex-col gap-2">
      <FormError message={state.error} />
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
        <div className="field col-span-2 sm:col-span-1">
          <label className="label" htmlFor={`rate-name-${zoneId}`}>Rate name</label>
          <input className="input" id={`rate-name-${zoneId}`} name="name" placeholder="Standard" required maxLength={40} />
        </div>
        <div className="field">
          <label className="label" htmlFor={`rate-price-${zoneId}`}>Price ({currencySymbol})</label>
          <input className="input num" id={`rate-price-${zoneId}`} name="price" inputMode="decimal" placeholder="0 for free" />
        </div>
        <div className="field">
          <label className="label" htmlFor={`rate-free-${zoneId}`}>Free over</label>
          <input className="input num" id={`rate-free-${zoneId}`} name="freeOver" inputMode="decimal" placeholder="Optional" />
        </div>
        <div className="field">
          <label className="label" htmlFor={`rate-min-${zoneId}`}>Days from</label>
          <input className="input num" id={`rate-min-${zoneId}`} name="minDays" type="number" min={0} max={120} />
        </div>
        <div className="field">
          <label className="label" htmlFor={`rate-max-${zoneId}`}>Days to</label>
          <input className="input num" id={`rate-max-${zoneId}`} name="maxDays" type="number" min={0} max={120} />
        </div>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Only for some order weights</summary>
        <p className="hint mt-1">Charge more for heavy orders with one rate per weight range. Set what each product weighs on its page.</p>
        <div className="grid grid-cols-2 gap-2 mt-2 max-w-sm">
          <div className="field">
            <label className="label" htmlFor={`rate-minkg-${zoneId}`}>Orders from (kg)</label>
            <input className="input num" id={`rate-minkg-${zoneId}`} name="minKg" inputMode="decimal" placeholder="0" />
          </div>
          <div className="field">
            <label className="label" htmlFor={`rate-maxkg-${zoneId}`}>Up to (kg)</label>
            <input className="input num" id={`rate-maxkg-${zoneId}`} name="maxKg" inputMode="decimal" placeholder="Any" />
          </div>
        </div>
      </details>
      <SubmitButton className="btn btn-secondary self-start">Add rate</SubmitButton>
    </form>
  );
}

export function DeleteButton({ kind, id, label }: { kind: "zone" | "rate"; id: string; label: string }) {
  const [state, action] = useActionState(kind === "zone" ? deleteZoneAction.bind(null, id) : deleteRateAction.bind(null, id), {} as FormState);
  return (
    <form action={action} className="flex items-center gap-2">
      <FormError message={state.error} />
      <button className="btn btn-secondary text-critical" aria-label={label}>{kind === "zone" ? "Delete zone" : "Remove"}</button>
    </form>
  );
}
