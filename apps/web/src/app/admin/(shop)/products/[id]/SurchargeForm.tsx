"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { surchargeAction, type SurchargeState } from "../../../customs-actions";

/** What each one of a bulky or heavy product adds to the shipping price. */
export function SurchargeForm({ productId, amount, currency }: { productId: string; amount: string; currency: string }) {
  const [state, action, pending] = useActionState(surchargeAction.bind(null, productId), {} as SurchargeState);
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
        <label className="label" htmlFor="product-surcharge">Extra shipping for each one ({currency})</label>
        <input className="input num" id="product-surcharge" name="surcharge" inputMode="decimal" maxLength={9} placeholder="0.00" defaultValue={amount} aria-describedby="product-surcharge-hint" />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save extra shipping"}</button>
      <p className="hint text-sm w-full" id="product-surcharge-hint">Leave it empty for none.</p>
      {state.saved && !pending && !state.error && <p className="banner banner-success w-full" role="status">Saved. Shipping on the product page, cart and checkout includes it.</p>}
    </form>
  );
}
