"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { setLocalDeliveryAction, type LocalDeliveryState } from "../../shipping-actions";

type Area = { postalPrefixes: string[]; priceMinor: number; freeOverMinor: number | null; note: string | null };

/** Local delivery's switch, area and price. Submitted by hand so React doesn't reset the fields after an error. */
export function LocalDeliveryForm({ area, symbol }: { area: Area | null; symbol: string }) {
  const [state, action, pending] = useActionState(setLocalDeliveryAction, {} as LocalDeliveryState);
  const [on, setOn] = useState(area !== null);
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
        <p role="status" className="banner banner-success">{state.saved ? `Saved. Buyers in ${state.saved.postalPrefixes.length === 1 ? "that area" : "those areas"} can choose local delivery.` : "Saved. Checkout doesn't offer local delivery."}</p>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Deliver orders myself nearby
      </label>
      {on && (
        <>
          <div className="field">
            <label className="label" htmlFor="delivery-postal">Postal codes you deliver to</label>
            <textarea className="input num" id="delivery-postal" name="postalPrefixes" rows={2} required defaultValue={area?.postalPrefixes.join(", ") ?? ""} aria-describedby="delivery-postal-hint" />
            <span id="delivery-postal-hint" className="hint">Separate them with commas. The start of a code covers every code that begins with it: 787 covers 78701 to 78799.</span>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="field w-40">
              <label className="label" htmlFor="delivery-price">Delivery price ({symbol})</label>
              <input className="input num" id="delivery-price" name="price" inputMode="decimal" defaultValue={((area?.priceMinor ?? 500) / 100).toFixed(2)} />
            </div>
            <div className="field w-48">
              <label className="label" htmlFor="delivery-free">Free on orders over ({symbol})</label>
              <input className="input num" id="delivery-free" name="freeOver" inputMode="decimal" placeholder="Optional" defaultValue={area?.freeOverMinor ? (area.freeOverMinor / 100).toFixed(2) : ""} />
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="delivery-note">When it arrives (optional)</label>
            <input className="input" id="delivery-note" name="note" maxLength={200} placeholder="Within 2 days, evenings" defaultValue={area?.note ?? ""} />
          </div>
        </>
      )}
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save local delivery"}</button>
      </div>
    </form>
  );
}
