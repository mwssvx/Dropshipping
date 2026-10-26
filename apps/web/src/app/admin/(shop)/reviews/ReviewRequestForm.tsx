"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { setReviewRequestDaysAction, type ReviewRequestState } from "../../growth-actions";

/** The email that asks buyers for a review a few days after their order arrives. */
export function ReviewRequestForm({ days }: { days: number }) {
  const [state, action, pending] = useActionState(setReviewRequestDaysAction, {} as ReviewRequestState);
  return (
    // Submitted by hand so React doesn't reset the fields after an error.
    <form
      className="flex flex-col gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved !== undefined && !pending && !state.error && (
        <p className="banner banner-success" role="status">
          {state.saved ? `Saved. Buyers are asked ${state.saved} ${state.saved === 1 ? "day" : "days"} after their order arrives.` : "Saved. Buyers aren't emailed for a review."}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="enabled" defaultChecked={days > 0} />
          Email buyers for a review
        </label>
        <input className="input num w-20" name="days" type="number" min={1} max={30} defaultValue={days || 7} aria-label="Days after delivery" />
        <span>days after their order arrives</span>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save"}</button>
      </div>
      <p className="hint">Once per order, with a link to the review form. Not for gifts, or buyers who unsubscribed from your emails.</p>
    </form>
  );
}
