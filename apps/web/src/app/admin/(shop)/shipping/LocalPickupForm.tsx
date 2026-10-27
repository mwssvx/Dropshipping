"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { setLocalPickupAction, type PickupState } from "../../shipping-actions";

/** Local pickup's switch, address and instructions. Submitted by hand so React doesn't reset the fields after an error. */
export function LocalPickupForm({ pickup }: { pickup: { address: string; instructions: string | null } | null }) {
  const [state, action, pending] = useActionState(setLocalPickupAction, {} as PickupState);
  const [on, setOn] = useState(pickup !== null);
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
        <p role="status" className="banner banner-success">{state.saved ? "Saved. Buyers can pick up orders of your own stock." : "Saved. Checkout doesn't offer pickup."}</p>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Let buyers pick up their order
      </label>
      {on && (
        <>
          <div className="field">
            <label className="label" htmlFor="pickup-address">Pickup address</label>
            <textarea className="input" id="pickup-address" name="address" rows={3} maxLength={300} required defaultValue={pickup?.address ?? ""} />
          </div>
          <div className="field">
            <label className="label" htmlFor="pickup-instructions">How to collect (optional)</label>
            <textarea className="input" id="pickup-instructions" name="instructions" rows={2} maxLength={500} defaultValue={pickup?.instructions ?? ""} aria-describedby="pickup-hint" />
            <span id="pickup-hint" className="hint">Opening hours, which door, what to bring. It&apos;s in the email buyers get when their order is ready.</span>
          </div>
        </>
      )}
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save pickup"}</button>
      </div>
    </form>
  );
}
