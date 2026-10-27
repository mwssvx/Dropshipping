"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { setGiftWrapAction, type GiftWrapState } from "../../shipping-actions";

/** Gift wrapping's switch, price and description. Submitted by hand so React doesn't reset the fields after an error. */
export function GiftWrapForm({ wrap, symbol }: { wrap: { priceMinor: number; note: string | null } | null; symbol: string }) {
  const [state, action, pending] = useActionState(setGiftWrapAction, {} as GiftWrapState);
  const [on, setOn] = useState(wrap !== null);
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
        <p role="status" className="banner banner-success">{state.saved ? "Saved. Buyers sending a gift can have it wrapped." : "Saved. Checkout doesn't offer gift wrapping."}</p>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Offer gift wrapping
      </label>
      {on && (
        <div className="flex flex-wrap gap-3">
          <div className="field w-40">
            <label className="label" htmlFor="wrap-price">Wrapping price ({symbol})</label>
            <input className="input num" id="wrap-price" name="price" inputMode="decimal" defaultValue={((wrap?.priceMinor ?? 400) / 100).toFixed(2)} />
          </div>
          <div className="field flex-1 min-w-48">
            <label className="label" htmlFor="wrap-note">What they get (optional)</label>
            <input className="input" id="wrap-note" name="note" maxLength={120} placeholder="Kraft paper and a ribbon" defaultValue={wrap?.note ?? ""} />
          </div>
        </div>
      )}
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save gift wrapping"}</button>
      </div>
    </form>
  );
}
