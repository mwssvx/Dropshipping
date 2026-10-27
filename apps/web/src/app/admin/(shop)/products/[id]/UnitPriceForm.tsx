"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { unitPriceAction, type UnitPriceState } from "../../../unit-price-actions";

type Row = { id: string; title: string; amount: string; unit: string; example: string | null };

/** What each option holds (250 g, 1.5 l, 6 items), so the store shows a price per kg, litre or item. */
export function UnitPriceForm({ productId, rows, units }: { productId: string; rows: Row[]; units: [string, string][] }) {
  const [state, action, pending] = useActionState(unitPriceAction.bind(null, productId), {} as UnitPriceState);
  const single = rows.length === 1;
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
        <p className="banner banner-success" role="status">{state.saved ? "Saved. The price per unit shows under the price on the store." : "Saved. No price per unit is shown."}</p>
      )}
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="variant" value={r.id} />
            <div className="field w-32">
              <label className="label" htmlFor={`amount-${r.id}`}>{single ? "Pack contents" : `Pack contents (${r.title})`}</label>
              <input className="input num" id={`amount-${r.id}`} name={`amount-${r.id}`} inputMode="decimal" autoComplete="off" placeholder="250" defaultValue={r.amount} />
            </div>
            <div className="field w-28">
              <label className="label" htmlFor={`unit-${r.id}`}>{single ? "Pack unit" : `Pack unit (${r.title})`}</label>
              <select className="input" id={`unit-${r.id}`} name={`unit-${r.id}`} defaultValue={r.unit}>
                {units.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </div>
            {r.example && <span className="hint text-sm pb-2 num">{r.example}</span>}
          </li>
        ))}
      </ul>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save price per unit"}</button>
      </div>
    </form>
  );
}
