"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { changePlanAction } from "../../money-actions";

export function PlanButton({ plan, label, primary }: { plan: string; label: string; primary?: boolean }) {
  const [state, action] = useActionState(changePlanAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="plan" value={plan} />
      <FormError message={state.error} />
      <SubmitButton className={`btn w-full ${primary ? "btn-primary" : "btn-secondary"}`} pendingText="Switching…">{label}</SubmitButton>
    </form>
  );
}
