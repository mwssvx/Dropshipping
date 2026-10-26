"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { productDetailsAction, type DetailsState } from "../../../details-actions";

/** The product page's details table, written one "Label: value" per line. */
export function DetailsForm({ productId, text, max }: { productId: string; text: string; max: number }) {
  const [state, action, pending] = useActionState(productDetailsAction.bind(null, productId), {} as DetailsState);
  return (
    // Submitted by hand so React doesn't reset the box after an error.
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
          {state.saved ? `Saved. ${state.saved === 1 ? "1 detail shows" : `${state.saved} details show`} under the description on the product page.` : "Saved. This product has no details table."}
        </p>
      )}
      <div className="field">
        <label className="label" htmlFor="details">Details</label>
        <textarea className="input font-mono text-sm" id="details" name="details" rows={6} defaultValue={text} spellCheck
          placeholder={"Material: Aluminium\nSize: 20 × 10 × 8 cm\nPower: USB-C, cable included"} aria-describedby="details-hint" />
        <p id="details-hint" className="hint text-sm">One per line, label first, then a colon. Up to {max}.</p>
      </div>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save details"}</button>
      </div>
    </form>
  );
}
