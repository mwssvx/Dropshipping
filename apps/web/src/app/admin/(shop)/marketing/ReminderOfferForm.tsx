"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { setReminderOfferAction, type ReminderOfferState } from "../../growth-actions";

/** The second checkout reminder's switch and percentage. Submitted by hand so React doesn't reset the fields after an error. */
export function ReminderOfferForm({ percentOff }: { percentOff: number | null }) {
  const [state, action, pending] = useActionState(setReminderOfferAction, {} as ReminderOfferState);
  const [on, setOn] = useState(percentOff !== null);
  return (
    <form
      className="flex flex-col gap-3 border-t border-border pt-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved !== undefined && !pending && !state.error && (
        <p role="status" className="banner banner-success">{state.saved ? `Saved. Second reminders give ${state.saved}% off.` : "Saved. No second reminders."}</p>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Send a second reminder a day later, with a code
      </label>
      {on && (
        <div className="field max-w-xs">
          <label className="label" htmlFor="reminder-percent">Code gives (% off)</label>
          <input className="input num" id="reminder-percent" name="percentOff" required inputMode="numeric" defaultValue={percentOff ?? 10} aria-describedby="reminder-percent-hint" />
          <span id="reminder-percent-hint" className="hint">5 to 50. Each code works once, only with the buyer&apos;s email, for 48 hours.</span>
        </div>
      )}
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save second reminder"}</button>
      </div>
    </form>
  );
}
