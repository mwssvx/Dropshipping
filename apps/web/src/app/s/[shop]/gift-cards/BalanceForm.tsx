"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { checkBalanceAction, type BalanceState } from "./actions";

/** The code box and the answer. Submitted by hand so the code stays in the box after a mistake. */
export function BalanceForm({ handle, text: t }: { handle: string; text: { code: string; check: string; checking: string; giftCard: string } }) {
  const [state, action, pending] = useActionState(checkBalanceAction.bind(null, handle), {} as BalanceState);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.result && !pending && (
        <p role="status" className={`banner ${state.result.ok ? "banner-success" : "banner-warning"}`}>
          <span className="font-medium">{t.giftCard} ···· {state.result.last4}</span>: {state.result.message}
        </p>
      )}
      <div className="field">
        <label className="label" htmlFor="gift-card-code">{t.code}</label>
        <input className="input font-mono uppercase" id="gift-card-code" name="code" required autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX-XXXX-XXXX" />
      </div>
      <button className="btn btn-primary self-start" disabled={pending} aria-busy={pending}>{pending ? t.checking : t.check}</button>
    </form>
  );
}
