"use client";
import Link from "next/link";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { resetPasswordAction, type ResetState } from "../../actions";

export function ResetForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction.bind(null, token), {} as ResetState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError message={state.error} />
      {state.error && <Link className="text-accent font-semibold" href="/forgot">Get a new link</Link>}
      <div className="field">
        <label className="label" htmlFor="password">New password</label>
        <input className="input" id="password" name="password" type="password" minLength={8} required autoComplete="new-password" />
        <span className="hint">At least 8 characters. You&apos;ll be signed out on other devices.</span>
      </div>
      <SubmitButton className="btn btn-primary btn-lg" pendingText="Saving…">Save and sign in</SubmitButton>
    </form>
  );
}
