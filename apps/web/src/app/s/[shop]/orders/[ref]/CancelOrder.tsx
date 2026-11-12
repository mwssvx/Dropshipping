"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { CancelState } from "../../actions";

/** "Cancel this order", folded away so it isn't the first thing a happy buyer sees. */
export type CancelText = { title: string; note: string; reason: string; button: string; pending: string };

export function CancelOrder({ action, text: t }: { action: (state: CancelState, form: FormData) => Promise<CancelState>; until: string; text: CancelText }) {
  const [state, formAction] = useActionState(action, {} as CancelState);
  // The page shows the cancellation once it's done.
  if (state.done) return null;
  return (
    <details className="card p-5">
      <summary className="cursor-pointer font-semibold">{t.title}</summary>
      <form action={formAction} className="flex flex-col gap-3 mt-3">
        <p className="text-sm text-muted">{t.note}</p>
        <FormError message={state.error} />
        <div className="field">
          <label className="label" htmlFor="cancelReason">{t.reason}</label>
          <input className="input" id="cancelReason" name="reason" maxLength={300} />
        </div>
        <SubmitButton className="btn btn-secondary self-start" pendingText={t.pending}>{t.button}</SubmitButton>
      </form>
    </details>
  );
}
