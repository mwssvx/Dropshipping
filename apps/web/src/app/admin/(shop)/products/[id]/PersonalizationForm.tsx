"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { personalizationAction, type PersonalizationState } from "../../../personalization-actions";

type Field = { id?: string; label: string; required: boolean; maxLength: number | string };
const MAX = 3;

/** Up to three text fields buyers fill in before adding to cart. */
export function PersonalizationForm({ productId, fields }: { productId: string; fields: { id: string; label: string; required: boolean; maxLength: number }[] }) {
  const [state, action, pending] = useActionState(personalizationAction.bind(null, productId), {} as PersonalizationState);
  const [rows, setRows] = useState<Field[]>(fields);
  const set = (i: number, patch: Partial<Field>) => setRows((r) => r.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  return (
    // Submitted by hand so React doesn't reset the rows after an error.
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData();
        data.set("fields", JSON.stringify(rows.map((r) => ({ ...r, maxLength: Number(r.maxLength) }))));
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved !== undefined && !pending && (
        <p className="banner banner-success" role="status">
          {state.saved ? "Saved. Buyers fill these in on the product page before adding it to their cart." : "Saved. This product has no personalisation."}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <li key={r.id ?? `new-${i}`} className="flex flex-wrap items-end gap-3 text-sm" aria-label={`Field ${i + 1}`}>
              <div className="field grow min-w-48">
                <label className="label" htmlFor={`pf-label-${i}`}>Label</label>
                <input className="input" id={`pf-label-${i}`} value={r.label} maxLength={40} placeholder="Name to engrave" onChange={(e) => set(i, { label: e.target.value })} />
              </div>
              <div className="field w-32">
                <label className="label" htmlFor={`pf-max-${i}`}>Max characters</label>
                <input className="input num" id={`pf-max-${i}`} type="number" min={1} max={200} value={r.maxLength} onChange={(e) => set(i, { maxLength: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 pb-2">
                <input type="checkbox" checked={r.required} onChange={(e) => set(i, { required: e.target.checked })} />
                Required
              </label>
              <button type="button" className="btn btn-secondary btn-sm mb-1" onClick={() => setRows((x) => x.filter((_, n) => n !== i))}>
                Remove<span className="sr-only"> field {i + 1}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-3">
        {rows.length < MAX && (
          <button type="button" className="btn btn-secondary" onClick={() => setRows((x) => [...x, { label: "", required: true, maxLength: 20 }])}>
            Add a field
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save personalisation"}</button>
      </div>
    </form>
  );
}
