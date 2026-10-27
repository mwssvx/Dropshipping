"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { setTippingAction, type TippingState } from "../../addon-actions";

/** Tips' switch, up to three percentages and a thank-you line. Submitted by hand so React doesn't reset the fields after an error. */
export function TipsForm({ tipping }: { tipping: { percents: number[]; note: string | null } | null }) {
  const [state, action, pending] = useActionState(setTippingAction, {} as TippingState);
  const [on, setOn] = useState(tipping !== null);
  const percents = tipping?.percents ?? [10, 15, 20];
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
        <p role="status" className="banner banner-success">{state.saved ? "Saved. Checkout asks buyers if they'd like to tip." : "Saved. Checkout doesn't ask for tips."}</p>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Ask for a tip at checkout
      </label>
      {on && (
        <>
          <fieldset className="flex flex-wrap gap-3">
            <legend className="label mb-1">Tip choices (% of the order)</legend>
            {[0, 1, 2].map((n) => (
              <input key={n} className="input num w-20" name="percent" inputMode="numeric" aria-label={`Tip choice ${n + 1}`} defaultValue={percents[n] ?? ""} />
            ))}
          </fieldset>
          <div className="field">
            <label className="label" htmlFor="tip-note">Thank-you line (optional)</label>
            <input className="input" id="tip-note" name="note" maxLength={120} placeholder="Every order is packed by hand. Thank you!" defaultValue={tipping?.note ?? ""} />
          </div>
        </>
      )}
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save tips"}</button>
      </div>
    </form>
  );
}
