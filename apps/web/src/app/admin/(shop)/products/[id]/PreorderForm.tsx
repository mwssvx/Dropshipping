"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { preorderAction, type PreorderState } from "../../../preorder-actions";

/** Pre-orders: sold-out options stay buyable, promised to ship by a date. */
export function PreorderForm({ productId, preorder, min, max }: { productId: string; preorder: { shipsBy: string; limit: number | null } | null; min: string; max: string }) {
  const [state, action, pending] = useActionState(preorderAction.bind(null, productId), {} as PreorderState);
  const [on, setOn] = useState(!!preorder);
  return (
    // Submitted by hand so React doesn't reset the fields after an error.
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved !== undefined && !pending && !state.error && (
        <p className="banner banner-success" role="status">
          {state.saved ? "Saved. Sold-out options can now be pre-ordered." : "Saved. Sold-out options can't be bought until they're back."}
        </p>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Take pre-orders while it's sold out
      </label>
      {on && (
        <div className="flex flex-wrap gap-3 items-end">
          <div className="field">
            <label className="label" htmlFor="pre-ships-by">Ships by</label>
            <input className="input" id="pre-ships-by" name="shipsBy" type="date" min={min} max={max} defaultValue={preorder?.shipsBy ?? ""} required />
          </div>
          <div className="field w-40">
            <label className="label" htmlFor="pre-limit">Most pre-orders</label>
            <input className="input num" id="pre-limit" name="limit" type="number" min={1} max={10000} placeholder="No limit" defaultValue={preorder?.limit ?? ""} />
          </div>
        </div>
      )}
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save pre-orders"}</button>
      </div>
    </form>
  );
}
