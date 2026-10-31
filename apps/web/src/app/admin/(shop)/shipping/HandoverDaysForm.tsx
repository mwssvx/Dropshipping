"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { setHandoverDaysAction, type HandoverDaysState } from "../../shipping-actions";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Monday first, as most shops plan their week.
const ORDER = [1, 2, 3, 4, 5, 6, 0];

/** The days buyers can pick to collect an order or have it delivered. Submitted by hand so React doesn't reset the fields after an error. */
export function HandoverDaysForm({ days, zones, defaultZone, maxLead }: { days: { weekdays: number[]; leadDays: number; timeZone: string } | null; zones: [string, string][]; defaultZone: string; maxLead: number }) {
  const [state, action, pending] = useActionState(setHandoverDaysAction, {} as HandoverDaysState);
  const [on, setOn] = useState(days !== null);
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
        <p role="status" className="banner banner-success">
          {state.saved ? `Saved. Buyers pick from ${ORDER.filter((d) => state.saved!.weekdays.includes(d)).map((d) => WEEKDAYS[d]).join(", ")} at checkout.` : "Saved. Buyers don't pick a day."}
        </p>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Buyers pick the day they collect or get their order
      </label>
      {on && (
        <>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
            <legend className="label mb-1">Days you hand over orders</legend>
            {ORDER.map((d) => (
              <label key={d} className="flex items-center gap-2">
                <input type="checkbox" name="weekday" value={d} defaultChecked={days ? days.weekdays.includes(d) : d >= 1 && d <= 5} />
                {WEEKDAYS[d]}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="field w-44">
              <label className="label" htmlFor="handover-lead">Notice you need</label>
              <select className="input" id="handover-lead" name="leadDays" defaultValue={days?.leadDays ?? 1}>
                {Array.from({ length: maxLead + 1 }, (_, n) => <option key={n} value={n}>{n === 0 ? "Same day" : n === 1 ? "1 day" : `${n} days`}</option>)}
              </select>
            </div>
            <div className="field flex-1 min-w-48">
              <label className="label" htmlFor="handover-zone">Your time zone</label>
              <select className="input" id="handover-zone" name="timeZone" defaultValue={days?.timeZone ?? defaultZone}>
                {zones.map(([z, name]) => <option key={z} value={z}>{name}</option>)}
              </select>
            </div>
          </div>
        </>
      )}
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save days"}</button>
      </div>
    </form>
  );
}
