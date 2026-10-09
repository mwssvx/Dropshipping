"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { customerNotesAction, eraseCustomerAction, type NotesState } from "../../../customer-actions";

export function NotesForm({ id, note, tags }: { id: string; note: string; tags: string }) {
  const [state, action] = useActionState(customerNotesAction.bind(null, id), {} as NotesState);
  const values = { note: state.note ?? note, tags: state.tags ?? tags };
  return (
    // Keyed by the values so the fields show what was saved (or typed) after each try.
    <form action={action} className="flex flex-col gap-3" key={JSON.stringify(values)}>
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Saved.</p>}
      <div className="field">
        <label className="label" htmlFor="tags">Tags</label>
        <input className="input" id="tags" name="tags" defaultValue={values.tags} placeholder="vip, wholesale lead" maxLength={500} />
        <span className="hint">Separate with commas. Use them to find groups of customers later.</span>
      </div>
      <div className="field">
        <label className="label" htmlFor="note">Note</label>
        <textarea className="input" id="note" name="note" rows={3} maxLength={2000} defaultValue={values.note} placeholder="Only you and your team see this." />
      </div>
      <SubmitButton className="btn btn-secondary self-start">Save note and tags</SubmitButton>
    </form>
  );
}

export function EraseForm({ id, email }: { id: string; email: string }) {
  const [state, action] = useActionState(eraseCustomerAction.bind(null, id), {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      <div className="field max-w-md">
        <label className="label" htmlFor="confirm">Type their email to confirm</label>
        <input className="input" id="confirm" name="confirm" type="email" autoComplete="off" placeholder={email} required />
      </div>
      <SubmitButton className="btn btn-secondary text-critical self-start" pendingText="Erasing…">Erase their data</SubmitButton>
    </form>
  );
}
