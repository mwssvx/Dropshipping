"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { minAgeAction, type MinAgeState } from "../../../customs-actions";

// 13 to 25, the range setMinAge takes.
const AGES = Array.from({ length: 13 }, (_, i) => 13 + i);

/** The age buyers must confirm at checkout to buy this product. */
export function MinAgeForm({ productId, minAge }: { productId: string; minAge: number | null }) {
  const [state, action, pending] = useActionState(minAgeAction.bind(null, productId), {} as MinAgeState);
  return (
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
        <label className="label" htmlFor="min-age">Buyers must be at least</label>
        <select className="input" id="min-age" name="minAge" defaultValue={minAge ?? ""}>
          <option value="">Any age</option>
          {AGES.map((a) => (
            <option key={a} value={a}>{a} years old</option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save age check"}</button>
      {state.saved && !pending && !state.error && <p className="banner banner-success w-full" role="status">Saved.</p>}
    </form>
  );
}
