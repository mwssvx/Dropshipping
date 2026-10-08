"use client";
import Link from "next/link";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { forgotPasswordAction, type ResetState } from "../actions";

export function ForgotForm() {
  const [state, action] = useActionState(forgotPasswordAction, {} as ResetState);
  if (state.sent) {
    return (
      <div className="flex flex-col gap-3" role="status">
        <p>If {state.email} has an account, we&apos;ve sent it a link to set a new password. The link works for an hour.</p>
        <p className="hint">Nothing arrived? Check spam, or try again in a few minutes.</p>
        <Link className="text-accent font-semibold" href="/login">Back to sign in</Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError message={state.error} />
      <p className="hint">Enter the email you sign in with and we&apos;ll send you a link.</p>
      <div className="field">
        <label className="label" htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email} />
      </div>
      <SubmitButton className="btn btn-primary btn-lg" pendingText="Sending…">Send reset link</SubmitButton>
      <Link className="hint text-center" href="/login">Back to sign in</Link>
    </form>
  );
}
