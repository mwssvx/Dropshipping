"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { packingSlipNoteAction, type PackingSlipNoteState } from "../../../tracking-import-actions";

export function PackingSlipNoteForm({ value }: { value: string }) {
  const [state, action, pending] = useActionState(packingSlipNoteAction, {} as PackingSlipNoteState);
  return (
    <form
      className="flex flex-col gap-3 mt-3 max-w-xl no-print"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      <div className="field">
        <label className="label" htmlFor="slip-note">Slip note</label>
        <textarea className="input" id="slip-note" name="note" rows={3} maxLength={500} defaultValue={value} placeholder="Thanks for your order! Use THANKS10 for 10% off next time." />
        <p className="hint">Printed at the foot of every packing slip. Leave it empty for none.</p>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save note"}</button>
        {state.saved && !pending && <span className="hint" role="status">Saved.</span>}
      </div>
    </form>
  );
}
