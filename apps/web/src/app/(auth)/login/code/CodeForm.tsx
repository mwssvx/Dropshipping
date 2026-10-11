"use client";
import Link from "next/link";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { twoStepAction, type CodeState } from "../../actions";

export function CodeForm({ next }: { next?: string }) {
  const [state, action] = useActionState(twoStepAction, {} as CodeState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError message={state.error} />
      {state.expired && <Link className="text-accent font-semibold" href="/login">Sign in again</Link>}
      {next && <input type="hidden" name="next" value={next} />}
      <div className="field">
        <label className="label" htmlFor="code">Code</label>
        <input className="input num" id="code" name="code" required autoFocus autoComplete="one-time-code" inputMode="text" maxLength={20} spellCheck={false} />
        <span className="hint">Lost your phone? Type one of your recovery codes instead.</span>
      </div>
      <SubmitButton className="btn btn-primary btn-lg" pendingText="Checking…">Sign in</SubmitButton>
    </form>
  );
}
