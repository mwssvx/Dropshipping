"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { reviewStoreAction } from "../../ai-actions";

export function ReviewStoreButton({ again }: { again: boolean }) {
  const [state, action] = useActionState(reviewStoreAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormError message={state.error} />
      <div><SubmitButton className={again ? "btn btn-secondary" : "btn btn-primary"} pendingText="Reviewing your store…">{again ? "Review again" : "Review my store"}</SubmitButton></div>
    </form>
  );
}
