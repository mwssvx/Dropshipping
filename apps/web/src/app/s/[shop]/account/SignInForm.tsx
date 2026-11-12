"use client";
import { useActionState } from "react";
import { accountText } from "@/lib/account-text";
import { buyerSignInAction, type SignInState } from "./actions";

export function SignInForm({ handle, next, lang }: { handle: string; next?: "saved"; lang?: string | null }) {
  const t = accountText(lang).signIn;
  const [state, action, pending] = useActionState(buyerSignInAction.bind(null, handle), { step: "email" } as SignInState);
  if (state.step === "code") {
    return (
      <form action={action} className="flex flex-col gap-4" key={`code-${state.email}`}>
        <p role="status">{t.sentBefore}<span className="font-semibold">{state.email}</span>{t.sentAfter}</p>
        {state.error && <p className="banner banner-critical" role="alert">{state.error}</p>}
        <input type="hidden" name="email" value={state.email} />
        {next && <input type="hidden" name="next" value={next} />}
        <div className="field">
          <label className="label" htmlFor="code">{t.code}</label>
          <input className="input text-lg tracking-[0.3em] num" id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus />
        </div>
        <button className="btn btn-primary btn-lg" disabled={pending}>{pending ? t.checking : t.signIn}</button>
        <button className="hint underline self-start" name="resend" value="1" formNoValidate disabled={pending}>{t.resend}</button>
      </form>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <p className="banner banner-critical" role="alert">{state.error}</p>}
      <div className="field">
        <label className="label" htmlFor="buyer-email">{t.email}</label>
        <input className="input" id="buyer-email" name="email" type="email" autoComplete="email" required defaultValue={state.email} />
        <span className="hint">{t.emailHint}</span>
      </div>
      <button className="btn btn-primary btn-lg" disabled={pending}>{pending ? t.sending : t.emailMe}</button>
    </form>
  );
}
