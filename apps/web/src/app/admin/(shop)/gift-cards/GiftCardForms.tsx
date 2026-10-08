"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../actions";
import { issueGiftCardAction, resendGiftCardAction, sellGiftCardsAction, setGiftCardDisabledAction } from "../../gift-card-actions";

export function SellForm({ currencySymbol }: { currencySymbol: string }) {
  const [state, action] = useActionState(sellGiftCardsAction, {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      <div className="field max-w-sm">
        <label className="label" htmlFor="amounts">Amounts ({currencySymbol})</label>
        <input className="input num" id="amounts" name="amounts" defaultValue="25, 50, 100" required />
        <span className="hint">Separate them with commas. You can change them later on the product.</span>
      </div>
      <SubmitButton className="btn btn-primary self-start">Start selling gift cards</SubmitButton>
    </form>
  );
}

export function IssueForm() {
  const [state, action] = useActionState(issueGiftCardAction, {} as FormState);
  return (
    <form key={state.saved ? Date.now() : "issue"} action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Gift card sent.</p>}
      <div className="grid sm:grid-cols-[1fr_10rem] gap-3">
        <div className="field">
          <label className="label" htmlFor="gc-email">Send to</label>
          <input className="input" id="gc-email" name="email" type="email" placeholder="buyer@example.com" required />
        </div>
        <div className="field">
          <label className="label" htmlFor="gc-amount">Amount</label>
          <input className="input num" id="gc-amount" name="amount" inputMode="decimal" placeholder="20.00" required />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="gc-note">Note in the email (optional)</label>
        <input className="input" id="gc-note" name="note" maxLength={500} placeholder="Sorry your lamp arrived broken. This one's on us." />
      </div>
      <SubmitButton className="btn btn-secondary self-start" pendingText="Sending…">Send gift card</SubmitButton>
    </form>
  );
}

export function CardActions({ id, disabled, usedUp }: { id: string; disabled: boolean; usedUp: boolean }) {
  const [resendState, resend] = useActionState(resendGiftCardAction.bind(null, id), {} as FormState);
  const [toggleState, toggle] = useActionState(setGiftCardDisabledAction.bind(null, id, !disabled), {} as FormState);
  return (
    <div className="flex flex-col items-end gap-1">
      <FormError message={resendState.error ?? toggleState.error} />
      {resendState.saved && <p className="text-sm text-success" role="status">New code sent.</p>}
      <div className="flex flex-wrap gap-2 justify-end">
        {!disabled && !usedUp && <form action={resend}><SubmitButton className="btn btn-secondary">Send a new code</SubmitButton></form>}
        <form action={toggle}><SubmitButton className={`btn btn-secondary ${disabled ? "" : "text-critical"}`}>{disabled ? "Turn on" : "Turn off"}</SubmitButton></form>
      </div>
    </div>
  );
}
