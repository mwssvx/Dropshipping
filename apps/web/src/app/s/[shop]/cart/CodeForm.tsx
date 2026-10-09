"use client";
import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { applyCodeAction, type CodeState } from "../actions";

export function CodeForm({ handle, text = { label: "Discount or gift card code", apply: "Apply", checking: "Checking…" } }: { handle: string; text?: { label: string; apply: string; checking: string } }) {
  const [state, action] = useActionState(applyCodeAction.bind(null, handle), {} as CodeState);
  return (
    <form action={action} className="flex flex-col gap-2 w-full max-w-xs self-end">
      <label className="label" htmlFor="code">{text.label}</label>
      <div className="flex gap-2">
        <input id="code" name="code" className="input flex-1 uppercase" autoComplete="off" aria-invalid={!!state.error} aria-describedby={state.error ? "code-error" : undefined} />
        <SubmitButton className="btn btn-secondary" pendingText={text.checking}>{text.apply}</SubmitButton>
      </div>
      {state.error && <p id="code-error" className="text-sm text-critical" role="alert">{state.error}</p>}
    </form>
  );
}
