"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { ArrivedState } from "../../actions";

/** "Got your order?" with one button, for a shipped order the carrier hasn't reported delivered. */
export function MarkArrived({ action, text }: { action: (state: ArrivedState, form: FormData) => Promise<ArrivedState>; text: { arrivedQuestion: string; markArrived: string; arrivedThanks: string } }) {
  const [state, formAction] = useActionState(action, {} as ArrivedState);
  if (state.done) return <p role="status" className="text-sm">{text.arrivedThanks}</p>;
  return (
    <form id="arrived" action={formAction} className="flex flex-wrap items-center gap-3 text-sm">
      <FormError message={state.error} />
      <span>{text.arrivedQuestion}</span>
      <SubmitButton className="btn btn-secondary" pendingText="…">{text.markArrived}</SubmitButton>
    </form>
  );
}
