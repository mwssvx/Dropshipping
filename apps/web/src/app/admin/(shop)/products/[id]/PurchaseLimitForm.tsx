"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { purchaseLimitAction, type PurchaseLimitState } from "../../../purchase-limit-actions";

/** The least and most a buyer can order, per order and in all. */
export function PurchaseLimitForm({ productId, limit }: { productId: string; limit: { min: number | null; max: number | null; perCustomer: number | null } | null }) {
  const [state, action, pending] = useActionState(purchaseLimitAction.bind(null, productId), {} as PurchaseLimitState);
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
          {state.saved ? "Saved. The cart and checkout now follow these limits." : "Saved. Buyers can order any amount."}
        </p>
      )}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="field w-40">
          <label className="label" htmlFor="limit-min">Least per order</label>
          <input className="input num" id="limit-min" name="min" type="number" min={1} max={99} placeholder="1" defaultValue={limit?.min ?? ""} />
        </div>
        <div className="field w-40">
          <label className="label" htmlFor="limit-max">Most per order</label>
          <input className="input num" id="limit-max" name="max" type="number" min={1} max={99} placeholder="No limit" defaultValue={limit?.max ?? ""} />
        </div>
        <div className="field w-40">
          <label className="label" htmlFor="limit-customer">Most per customer</label>
          <input className="input num" id="limit-customer" name="perCustomer" type="number" min={1} max={999} placeholder="No limit" defaultValue={limit?.perCustomer ?? ""} />
        </div>
      </div>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save limits"}</button>
      </div>
    </form>
  );
}
