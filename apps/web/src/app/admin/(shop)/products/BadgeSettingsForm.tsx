"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { badgeSettingsAction, type BadgeState } from "../../badge-actions";

/** The automatic badges on product cards. */
export function BadgeSettingsForm({ sale, soldOut, newDays }: { sale: boolean; soldOut: boolean; newDays: number }) {
  const [state, action, pending] = useActionState(badgeSettingsAction, {} as BadgeState);
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
      {state.saved && !pending && !state.error && <p className="banner banner-success" role="status">Saved. Product cards show these badges now.</p>}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="sale" defaultChecked={sale} />
        How much is off, like “-20%”, on products on sale
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="soldOut" defaultChecked={soldOut} />
        “Sold out” when nothing can be ordered
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <div className="field w-48">
          <label className="label" htmlFor="badge-new-days">“New” for this many days</label>
          <input className="input num" id="badge-new-days" name="newDays" type="number" min={0} max={90} defaultValue={newDays} />
        </div>
        <p className="hint pb-2">0 turns it off.</p>
      </div>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save badges"}</button>
      </div>
    </form>
  );
}
