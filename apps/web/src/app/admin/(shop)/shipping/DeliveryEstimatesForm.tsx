"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import type { FormState } from "../../actions";
import { setDeliveryEstimatesAction } from "../../shipping-actions";

/** Submitted by hand so React doesn't reset the checkbox after an error. */
export function DeliveryEstimatesForm({ enabled, processingDays }: { enabled: boolean; processingDays: number }) {
  const [state, action, pending] = useActionState(setDeliveryEstimatesAction, {} as FormState);
  const [on, setOn] = useState(enabled);
  const [days, setDays] = useState(String(processingDays));
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved && <p role="status" className="banner banner-info">{on ? "Saved. Product pages, order pages and receipts show the new dates." : "Turned off. Buyers won't see delivery dates."}</p>}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="on" checked={on} onChange={(e) => setOn(e.target.checked)} /> Show delivery dates to buyers
      </label>
      <div className="field max-w-48">
        <label className="label" htmlFor="processingDays">Processing days</label>
        <input className="input num" id="processingDays" name="processingDays" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        <span className="hint text-xs">Days before the supplier sends an order out</span>
      </div>
      <div><button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save delivery dates"}</button></div>
    </form>
  );
}
