"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { blockEmailAction, type BlockState } from "../../blocked-actions";

/** Block an email address that hasn't ordered yet, or one a store warned you about. */
export function BlockEmailForm() {
  const [state, action, pending] = useActionState(blockEmailAction, {} as BlockState);
  return (
    // Submitted by hand so React doesn't reset the fields after an error.
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved && !pending && !state.error && <p className="banner banner-success" role="status">Blocked. Checkout turns them away.</p>}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="field flex-1 min-w-56">
          <label className="label" htmlFor="block-email">Email to block</label>
          <input className="input" id="block-email" name="email" type="email" required />
        </div>
        <div className="field flex-1 min-w-56">
          <label className="label" htmlFor="block-note">Why (only you see this)</label>
          <input className="input" id="block-note" name="note" maxLength={200} />
        </div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Blocking…" : "Block"}</button>
      </div>
    </form>
  );
}
