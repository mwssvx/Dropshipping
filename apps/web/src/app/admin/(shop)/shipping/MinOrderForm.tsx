"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { setMinOrderAction, type MinOrderState } from "../../shipping-actions";

/** The smallest order's amount. Submitted by hand so React doesn't reset the field after an error. */
export function MinOrderForm({ min, symbol }: { min: string; symbol: string }) {
  const [state, action, pending] = useActionState(setMinOrderAction, {} as MinOrderState);
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
        <p role="status" className="banner banner-success">{state.saved ? "Saved. Smaller carts are asked to add a little more before checkout." : "Saved. You take orders of any amount."}</p>
      )}
      <div className="field w-48">
        <label className="label" htmlFor="min-order-amount">Smallest order ({symbol})</label>
        <input className="input num" id="min-order-amount" name="min" inputMode="decimal" placeholder="Any amount" defaultValue={min} />
      </div>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save smallest order"}</button>
      </div>
    </form>
  );
}
