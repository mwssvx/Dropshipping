"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { setThankYouNoteAction } from "../../growth-actions";

export function ThankYouForm({ note, max }: { note: string | null; max: number }) {
  const [state, action] = useActionState(setThankYouNoteAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      <div className="field">
        <label className="label" htmlFor="thankYouNote">Thank-you note</label>
        <textarea
          className="input"
          id="thankYouNote"
          name="note"
          rows={3}
          maxLength={max}
          defaultValue={note ?? ""}
          placeholder="Follow us on Instagram @yourstore for new arrivals."
        />
        <span className="hint">Leave it empty for no note.</span>
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton className="btn btn-primary" pendingText="Saving…">Save note</SubmitButton>
        {state.saved && <p role="status" className="text-sm">Saved.</p>}
      </div>
    </form>
  );
}
