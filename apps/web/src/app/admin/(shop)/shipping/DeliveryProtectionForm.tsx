"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { setDeliveryProtectionAction, type ProtectionState } from "../../shipping-actions";

/** Delivery protection's switch and price. Submitted by hand so React doesn't reset the fields after an error. */
export function DeliveryProtectionForm({ protection, symbol }: { protection: { percent: number; minMinor: number } | null; symbol: string }) {
  const [state, action, pending] = useActionState(setDeliveryProtectionAction, {} as ProtectionState);
  const [on, setOn] = useState(protection !== null);
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
        <p role="status" className="banner banner-success">{state.saved ? `Saved. Buyers can add protection for ${state.saved.percent}% of their order.` : "Saved. Checkout doesn't offer protection."}</p>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Offer delivery protection at checkout
      </label>
      {on && (
        <div className="flex flex-wrap gap-3">
          <div className="field w-40">
            <label className="label" htmlFor="protection-share">Charge (% of items)</label>
            <input className="input num" id="protection-share" name="percent" required inputMode="decimal" defaultValue={protection?.percent ?? 3} aria-describedby="protection-hint" />
          </div>
          <div className="field w-40">
            <label className="label" htmlFor="protection-floor">But no less than ({symbol})</label>
            <input className="input num" id="protection-floor" name="min" inputMode="decimal" defaultValue={((protection?.minMinor ?? 100) / 100).toFixed(2)} />
          </div>
          <span id="protection-hint" className="hint w-full">0.5% to 10% of the items after discounts. Most stores charge 2% to 4%.</span>
        </div>
      )}
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save protection"}</button>
      </div>
    </form>
  );
}
