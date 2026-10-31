"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { setReviewRewardAction, type ReviewRewardState } from "../../growth-actions";

/** A percent off the buyer's next order, emailed as a thank-you once they review what they bought. */
export function ReviewRewardForm({ percent }: { percent: number | null }) {
  const [state, action, pending] = useActionState(setReviewRewardAction, {} as ReviewRewardState);
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
          {state.saved ? `Saved. Buyers get ${state.saved}% off their next order for a review.` : "Saved. No thank-you code for reviews."}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="enabled" defaultChecked={percent !== null} />
          Thank buyers for a review with
        </label>
        <input className="input num w-20" name="percent" type="number" min={5} max={30} defaultValue={percent ?? 10} aria-label="Thank-you percent off" />
        <span>% off their next order</span>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save"}</button>
      </div>
      <p className="hint">
        Emailed as a one-time code (60 days, their email only) once they review something they bought, whatever the stars, and once per order.
        Those reviews say &ldquo;Got a thank-you code for reviewing&rdquo;, so shoppers know, as the FTC and Google ask. The review request email mentions it.
      </p>
    </form>
  );
}
