"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { draftWinbackAction, findTrendsAction, reviewStoreAction } from "../../ai-actions";

export function ReviewStoreButton({ again }: { again: boolean }) {
  const [state, action] = useActionState(reviewStoreAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormError message={state.error} />
      <div><SubmitButton className={again ? "btn btn-secondary" : "btn btn-primary"} pendingText="Reviewing your store…">{again ? "Review again" : "Review my store"}</SubmitButton></div>
    </form>
  );
}

export function FindTrendsForm({ again }: { again: boolean }) {
  const [state, action] = useActionState(findTrendsAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      <div className="field max-w-md">
        <label className="label" htmlFor="focus">What kind of products? (optional)</label>
        <input className="input" id="focus" name="focus" maxLength={120} placeholder="Gifts for dog owners, cosy lighting, back to school…" />
      </div>
      <div><SubmitButton className={again ? "btn btn-secondary" : "btn btn-primary"} pendingText="Searching for trends…">Find trending products</SubmitButton></div>
    </form>
  );
}

export function DraftWinbackButton() {
  const [state, action] = useActionState(draftWinbackAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormError message={state.error} />
      <div><SubmitButton className="btn btn-secondary" pendingText="Drafting…">Draft a win-back email with AI</SubmitButton></div>
    </form>
  );
}
