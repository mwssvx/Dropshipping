"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { lowStockNoteAction, type LowStockState } from "../../stock-actions";

/** When product pages say "Only N left". */
export function LowStockForm({ value }: { value: number }) {
  const [state, action, pending] = useActionState(lowStockNoteAction, {} as LowStockState);
  return (
    // Submitted by hand so React doesn't reset the field after an error.
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
          {state.saved ? `Saved. Options with ${state.saved} or fewer left say so.` : "Saved. Product pages don't say how many are left."}
        </p>
      )}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="field w-48">
          <label className="label" htmlFor="lowStockNote">Say how many are left at</label>
          <input className="input num" id="lowStockNote" name="lowStockNote" type="number" min={0} max={50} defaultValue={value} aria-describedby="lowStockNote-hint" />
        </div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save"}</button>
      </div>
      <p id="lowStockNote-hint" className="hint text-sm">Or fewer. 0 turns it off.</p>
    </form>
  );
}
