"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { processingDaysAction, type ProcessingDaysState } from "../../../customs-actions";

/** The days this product takes to get ready before it ships, when that isn't the store's usual time. */
export function ProcessingDaysForm({ productId, days, storeDays }: { productId: string; days: number | null; storeDays: number }) {
  const [state, action, pending] = useActionState(processingDaysAction.bind(null, productId), {} as ProcessingDaysState);
  return (
    // Submitted by hand so React doesn't reset the field after an error.
    <form
      className="flex flex-wrap gap-3 items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      <div className="field w-56">
        <label className="label" htmlFor="product-processing">Days to get it ready</label>
        <input className="input num" id="product-processing" name="processingDays" inputMode="numeric" maxLength={2} placeholder={String(storeDays)} defaultValue={days ?? ""} aria-describedby="product-processing-hint" />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save preparing time"}</button>
      <p className="hint text-sm w-full" id="product-processing-hint">Leave it empty to use your store&apos;s {storeDays} {storeDays === 1 ? "day" : "days"}.</p>
      {state.saved && !pending && !state.error && <p className="banner banner-success w-full" role="status">Saved. Delivery dates for this product count it.</p>}
    </form>
  );
}
