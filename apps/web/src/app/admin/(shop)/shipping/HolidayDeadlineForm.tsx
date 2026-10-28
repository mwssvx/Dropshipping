"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { setHolidayDeadlineAction, type HolidayDeadlineState } from "../../shipping-actions";

const dayLabel = (d: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/** The holiday product pages count back from: its switch, name and arrive-by day. Submitted by hand so React doesn't reset the fields after an error. */
export function HolidayDeadlineForm({ deadline, days }: { deadline: { name: string; arriveBy: string } | null; days: { min: string; max: string } }) {
  const [state, action, pending] = useActionState(setHolidayDeadlineAction, {} as HolidayDeadlineState);
  const [on, setOn] = useState(deadline !== null);
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
          {state.saved ? `Saved. Product pages say when to order for ${state.saved.name}, arriving by ${dayLabel(state.saved.arriveBy)}.` : "Saved. There's no holiday order-by date."}
        </p>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Show an order-by date for a holiday
      </label>
      {on && (
        <div className="flex flex-wrap gap-3 items-end">
          <div className="field flex-1 min-w-48">
            <label className="label" htmlFor="holiday-name">Holiday</label>
            <input className="input" id="holiday-name" name="name" maxLength={40} placeholder="Christmas" defaultValue={deadline?.name ?? ""} />
          </div>
          <div className="field w-48">
            <label className="label" htmlFor="holiday-arrive-by">Must arrive by</label>
            <input className="input" id="holiday-arrive-by" name="arriveBy" type="date" min={days.min} max={days.max} defaultValue={deadline?.arriveBy ?? ""} />
          </div>
        </div>
      )}
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save holiday date"}</button>
      </div>
    </form>
  );
}
