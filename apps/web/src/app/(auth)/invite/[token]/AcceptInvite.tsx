"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { acceptInviteAction, type InviteState } from "../../actions";

export function AcceptInvite({ token, shopName }: { token: string; shopName: string }) {
  const [state, action] = useActionState(acceptInviteAction.bind(null, token), {} as InviteState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      <SubmitButton className="btn btn-primary btn-lg" pendingText="Joining…">Join {shopName}</SubmitButton>
    </form>
  );
}
