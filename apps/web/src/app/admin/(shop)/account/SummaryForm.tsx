"use client";
import { startTransition, useActionState } from "react";
import { weeklySummaryAction, type SummaryState } from "../../account-actions";

/** On or off for the Monday summary of this store. */
export function SummaryForm({ shopName, on }: { shopName: string; on: boolean }) {
  const [state, action, pending] = useActionState(weeklySummaryAction, {} as SummaryState);
  return (
    // Submitted by hand so React doesn't reset the box after saving.
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      {state.saved !== undefined && !pending && (
        <p className="banner banner-success" role="status">{state.saved ? `Saved. You'll get ${shopName}'s summary on Mondays.` : `Saved. You won't get ${shopName}'s summary any more.`}</p>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="weeklySummary" defaultChecked={on} />
        Email me a summary of {shopName} every Monday
      </label>
      <button type="submit" className="btn btn-secondary self-start" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save"}</button>
    </form>
  );
}
