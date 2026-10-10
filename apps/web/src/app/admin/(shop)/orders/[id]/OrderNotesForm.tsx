"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { orderNotesAction, type OrderNotesState } from "../../../actions";

/** The merchant's own note and tags on an order. The buyer never sees them. */
export function OrderNotesForm({ id, note, tags }: { id: string; note: string; tags: string }) {
  const [state, action] = useActionState(orderNotesAction.bind(null, id), {} as OrderNotesState);
  const values = { note: state.note ?? note, tags: state.tags ?? tags };
  return (
    // Keyed by the values so the fields show what was saved (or typed) after each try.
    <form action={action} className="flex flex-col gap-3" key={JSON.stringify(values)}>
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Saved.</p>}
      <div className="field">
        <label className="label" htmlFor="order-tags">Tags</label>
        <input className="input" id="order-tags" name="tags" defaultValue={values.tags} placeholder="follow up, priority" maxLength={500} />
        <span className="hint">Separate with commas. Filter the order list by them.</span>
      </div>
      <div className="field">
        <label className="label" htmlFor="order-note">Note</label>
        <textarea className="input" id="order-note" name="note" rows={3} maxLength={2000} defaultValue={values.note} placeholder="Only you and your team see this." />
      </div>
      <SubmitButton className="btn btn-secondary self-start">Save note and tags</SubmitButton>
    </form>
  );
}
