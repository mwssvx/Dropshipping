"use client";
import { useActionState } from "react";
import { buyerSignInAction, type SignInState } from "./actions";

export function SignInForm({ handle, next }: { handle: string; next?: "saved" }) {
  const [state, action, pending] = useActionState(buyerSignInAction.bind(null, handle), { step: "email" } as SignInState);
  if (state.step === "code") {
    return (
      <form action={action} className="flex flex-col gap-4" key={`code-${state.email}`}>
        <p role="status">We sent a 6-digit code to <span className="font-semibold">{state.email}</span>. It works for 10 minutes.</p>
        {state.error && <p className="banner banner-critical" role="alert">{state.error}</p>}
        <input type="hidden" name="email" value={state.email} />
        {next && <input type="hidden" name="next" value={next} />}
        <div className="field">
          <label className="label" htmlFor="code">Code</label>
          <input className="input text-lg tracking-[0.3em] num" id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus />
        </div>
        <button className="btn btn-primary btn-lg" disabled={pending}>{pending ? "Checking…" : "Sign in"}</button>
        <button className="hint underline self-start" name="resend" value="1" formNoValidate disabled={pending}>Send a new code</button>
      </form>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <p className="banner banner-critical" role="alert">{state.error}</p>}
      <div className="field">
        <label className="label" htmlFor="buyer-email">Email</label>
        <input className="input" id="buyer-email" name="email" type="email" autoComplete="email" required defaultValue={state.email} />
        <span className="hint">The one you used at checkout. We&apos;ll email you a code; no password needed.</span>
      </div>
      <button className="btn btn-primary btn-lg" disabled={pending}>{pending ? "Sending…" : "Email me a code"}</button>
    </form>
  );
}
