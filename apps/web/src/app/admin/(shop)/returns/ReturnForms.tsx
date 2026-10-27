"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../actions";
import { decideReturnAction, returnSettingsAction } from "../../return-actions";

export function ReturnSettingsForm({ windowDays, instructions, placeholder }: { windowDays: number; instructions: string; placeholder: string }) {
  const [state, action] = useActionState(returnSettingsAction, {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Return settings saved.</p>}
      <div className="field max-w-xs">
        <label className="label" htmlFor="windowDays">Days buyers have to ask</label>
        <input className="input num" id="windowDays" name="windowDays" type="number" min={0} max={365} defaultValue={windowDays} required />
        <span className="hint">Counted from delivery. 0 turns off the return form; buyers then email you instead.</span>
      </div>
      <div className="field">
        <label className="label" htmlFor="instructions">What buyers do after you approve</label>
        <textarea className="input" id="instructions" name="instructions" rows={3} maxLength={1000} defaultValue={instructions} placeholder={placeholder} />
        <span className="hint">Sent with every approval, unless you write something else on that return. For cheap items, many stores say &ldquo;Keep it&rdquo; and refund straight away.</span>
      </div>
      <SubmitButton className="btn btn-secondary self-start">Save return settings</SubmitButton>
    </form>
  );
}

function Choice({ value, children, className }: { value: string; children: React.ReactNode; className: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" name="decision" value={value} className={className} disabled={pending} aria-busy={pending}>{children}</button>;
}

export function DecideForm({ id, approved, exchange, amount, max }: { id: string; approved: boolean; exchange: boolean; amount: string; max: string }) {
  const [state, action] = useActionState(decideReturnAction.bind(null, id), {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-3 border-t border-border pt-3">
      <FormError message={state.error} />
      <div className="grid sm:grid-cols-[10rem_1fr] gap-3">
        <div className="field">
          <label className="label" htmlFor={`amount-${id}`}>Amount</label>
          <input className="input num" id={`amount-${id}`} name="amount" inputMode="decimal" defaultValue={amount} />
          <span className="hint">Up to {max}</span>
        </div>
        <div className="field">
          <label className="label" htmlFor={`message-${id}`}>Message to the buyer</label>
          <textarea className="input" id={`message-${id}`} name="message" rows={2} maxLength={1000}
            placeholder={approved ? "Optional" : "Optional for approving (your usual instructions are sent). Needed to decline."} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {exchange && <Choice value="exchange" className="btn btn-primary">Send the exchange</Choice>}
        {!approved && <Choice value="approve" className="btn btn-secondary">Approve</Choice>}
        <Choice value="refund" className={exchange ? "btn btn-secondary" : "btn btn-primary"}>Refund</Choice>
        <Choice value="credit" className="btn btn-secondary">Give store credit</Choice>
        <Choice value="replace" className="btn btn-secondary">Send a replacement</Choice>
        <Choice value="decline" className="btn btn-secondary text-critical">Decline</Choice>
      </div>
    </form>
  );
}
