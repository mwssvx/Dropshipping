"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { searchFixAction, type SearchFixState } from "../../search-fix-actions";

/** Points what shoppers searched for at words that find something. */
export function SearchFixForm({ from, max }: { from: string; max: number }) {
  const [state, action, pending] = useActionState(searchFixAction, {} as SearchFixState);
  return (
    // Submitted by hand so React doesn't clear the fields after an error.
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved && !pending && !state.error && <p className="banner banner-success" role="status">Saved. Searching “{state.saved}” now shows those results.</p>}
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end">
        <div className="field">
          <label className="label" htmlFor="fix-from">When shoppers search for</label>
          <input className="input" id="fix-from" name="from" maxLength={max} autoComplete="off" defaultValue={from} placeholder="lampshade" />
        </div>
        <div className="field">
          <label className="label" htmlFor="fix-to">Show the results for</label>
          <input className="input" id="fix-to" name="to" maxLength={max} autoComplete="off" placeholder="lamp shade" />
        </div>
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save fix"}</button>
      </div>
    </form>
  );
}
