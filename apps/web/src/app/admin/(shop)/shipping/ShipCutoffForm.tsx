"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { setShipCutoffAction, type ShipCutoffState } from "../../shipping-actions";

const hourLabel = (h: number) => new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 1, h)));

/** The same-day cutoff: its switch, time, time zone and weekends. Submitted by hand so React doesn't reset the fields after an error. */
export function ShipCutoffForm({ cutoff, zones, defaultZone }: { cutoff: { hour: number; timeZone: string; weekends: boolean } | null; zones: [string, string][]; defaultZone: string }) {
  const [state, action, pending] = useActionState(setShipCutoffAction, {} as ShipCutoffState);
  const [on, setOn] = useState(cutoff !== null);
  return (
    <form
      className="flex flex-col gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved !== undefined && !pending && !state.error && (
        <p role="status" className="banner banner-success">{state.saved ? `Saved. Orders in by ${hourLabel(state.saved.hour)} ship that day.` : "Saved. There's no same-day cutoff."}</p>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Orders in by a set time ship that day
      </label>
      {on && (
        <div className="flex flex-wrap gap-3 items-end">
          <div className="field w-36">
            <label className="label" htmlFor="cutoff-hour">Order by</label>
            <select className="input" id="cutoff-hour" name="hour" defaultValue={cutoff?.hour ?? 14}>
              {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
          </div>
          <div className="field flex-1 min-w-48">
            <label className="label" htmlFor="cutoff-zone">Your time zone</label>
            <select className="input" id="cutoff-zone" name="timeZone" defaultValue={cutoff?.timeZone ?? defaultZone}>
              {zones.map(([z, name]) => <option key={z} value={z}>{name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 pb-2">
            <input type="checkbox" name="weekends" defaultChecked={cutoff?.weekends ?? false} />
            We ship at weekends
          </label>
        </div>
      )}
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save cutoff"}</button>
      </div>
    </form>
  );
}
