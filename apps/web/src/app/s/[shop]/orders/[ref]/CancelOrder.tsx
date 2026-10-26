"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { CancelState } from "../../actions";

/** "Cancel this order", folded away so it isn't the first thing a happy buyer sees. */
export function CancelOrder({ action, until }: { action: (state: CancelState, form: FormData) => Promise<CancelState>; until: string }) {
  const [state, formAction] = useActionState(action, {} as CancelState);
  // The page shows the cancellation once it's done.
  if (state.done) return null;
  return (
    <details className="card p-5">
      <summary className="cursor-pointer font-semibold">Cancel this order</summary>
      <form action={formAction} className="flex flex-col gap-3 mt-3">
        <p className="text-sm text-muted">You can cancel it here until {until} UTC, as long as it hasn&apos;t shipped. You&apos;ll get all your money back.</p>
        <FormError message={state.error} />
        <div className="field">
          <label className="label" htmlFor="cancelReason">Why are you cancelling? (optional)</label>
          <input className="input" id="cancelReason" name="reason" maxLength={300} />
        </div>
        <SubmitButton className="btn btn-secondary self-start" pendingText="Cancelling…">Cancel order and refund me</SubmitButton>
      </form>
    </details>
  );
}
