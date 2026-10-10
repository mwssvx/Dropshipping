"use client";
import { useActionState } from "react";
import { claimReferralAction, type ReferState } from "../../actions";

export function ReferForm({ handle, code, labels }: { handle: string; code: string; labels: { email: string; button: string; sent: string; invalid: string; gone: string } }) {
  const [state, action, pending] = useActionState<ReferState, FormData>(claimReferralAction.bind(null, handle, code), {});
  if (state.sent) return <p role="status" className="banner banner-success">{labels.sent.replace("{email}", state.sent)}</p>;
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.error && <p role="alert" className="banner banner-critical">{state.error === "gone" ? labels.gone : labels.invalid}</p>}
      <div className="field">
        <label className="label" htmlFor="refer-email">{labels.email}</label>
        <input className="input" id="refer-email" name="email" type="email" required autoComplete="email" />
      </div>
      <button className="btn btn-primary self-start" disabled={pending}>{labels.button}</button>
    </form>
  );
}
