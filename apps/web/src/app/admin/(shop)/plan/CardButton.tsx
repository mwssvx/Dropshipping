"use client";
import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { cardSettingsAction } from "../../money-actions";

/** Sends the merchant to the billing page to update or remove the card their plan is paid with. */
export function CardButton() {
  const [state, action] = useActionState(cardSettingsAction, {});
  return (
    <form action={action} className="flex flex-col gap-2 items-start">
      <SubmitButton className="btn btn-secondary" pendingText="Opening…">Update or remove your card</SubmitButton>
      {state.message && <p className="hint text-sm" role="status">{state.message}</p>}
    </form>
  );
}
