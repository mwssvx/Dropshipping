"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { blockedCountriesAction, type BlockedCountriesState } from "../../../customs-actions";

/** A tick for each country the store ships to; ticked ones can't get this product. */
export function BlockedCountriesForm({ productId, blocked, countries }: { productId: string; blocked: string[]; countries: [string, string][] }) {
  const [state, action, pending] = useActionState(blockedCountriesAction.bind(null, productId), {} as BlockedCountriesState);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      <fieldset>
        <legend className="label mb-2">Can&apos;t ship to</legend>
        <div className="grid gap-x-4 gap-y-1 grid-cols-2 sm:grid-cols-3 text-sm">
          {countries.map(([code, name]) => (
            <label key={code} className="flex items-center gap-2">
              <input type="checkbox" name="country" value={code} defaultChecked={blocked.includes(code)} />
              {name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save countries"}</button>
        {state.saved && !pending && !state.error && <p className="banner banner-success" role="status">Saved.</p>}
      </div>
    </form>
  );
}
