"use client";
import Link from "next/link";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { AuthState } from "./actions";

export function AuthForm({
  mode,
  action,
}: {
  mode: "signup" | "login";
  action: (s: AuthState, f: FormData) => Promise<AuthState>;
}) {
  const [state, formAction] = useActionState(action, {});
  const signup = mode === "signup";
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError message={state.error} />
      <div className="field">
        <label className="label" htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email} />
      </div>
      <div className="field">
        <label className="label" htmlFor="password">Password</label>
        <input className="input" id="password" name="password" type="password" minLength={8} required
          autoComplete={signup ? "new-password" : "current-password"} />
        {signup ? <span className="hint">At least 8 characters.</span> : <Link className="hint hover:text-ink self-end" href="/forgot">Forgot your password?</Link>}
      </div>
      <SubmitButton className="btn btn-primary btn-lg" pendingText={signup ? "Creating account…" : "Signing in…"}>
        {signup ? "Create account" : "Sign in"}
      </SubmitButton>
      <p className="hint text-center">
        {signup ? <>Already have an account? <Link className="text-accent font-semibold" href="/login">Sign in</Link></>
          : <>New here? <Link className="text-accent font-semibold" href="/signup">Create an account</Link></>}
      </p>
    </form>
  );
}
