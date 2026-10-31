"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { setShipPauseAction, type ShipPauseState } from "../../shipping-actions";

const dayLabel = (d: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/** A break in shipping while orders keep coming in: when it starts, when shipping resumes, and a note. Submitted by hand so React doesn't reset the fields after an error. */
export function ShipPauseForm({ pause, today, max }: { pause: { from: string | null; resumesOn: string; message: string | null } | null; today: string; max: number }) {
  const [state, action, pending] = useActionState(setShipPauseAction, {} as ShipPauseState);
  const [on, setOn] = useState(pause !== null);
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
          {state.saved
            ? `Saved. From ${dayLabel(state.saved.from ?? state.saved.resumesOn)}, every store page says orders ship from ${dayLabel(state.saved.resumesOn)}, and delivery dates count from then.`
            : "Saved. Shipping isn't paused."}
        </p>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Pause shipping for a while
      </label>
      {on && (
        <>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="field w-48">
              <label className="label" htmlFor="pause-from">Starting (optional)</label>
              <input className="input" id="pause-from" name="from" type="date" min={today} defaultValue={pause?.from && pause.from > today ? pause.from : ""} aria-describedby="pause-from-hint" />
            </div>
            <div className="field w-48">
              <label className="label" htmlFor="pause-resumes">Orders ship again on</label>
              <input className="input" id="pause-resumes" name="resumesOn" type="date" min={today} required defaultValue={pause?.resumesOn ?? ""} />
            </div>
          </div>
          <p id="pause-from-hint" className="hint">Leave the start empty to pause from today. A pause lasts up to {max} days.</p>
          <div className="field">
            <label className="label" htmlFor="pause-message">A few words for buyers (optional)</label>
            <input className="input" id="pause-message" name="message" maxLength={300} defaultValue={pause?.message ?? ""} placeholder="Our supplier is closed for Chinese New Year." />
          </div>
        </>
      )}
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save shipping pause"}</button>
      </div>
    </form>
  );
}
