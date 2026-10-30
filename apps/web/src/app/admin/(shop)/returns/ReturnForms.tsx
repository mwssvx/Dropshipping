"use client";
import { startTransition, useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../actions";
import { decideReturnAction, holidayReturnsAction, returnSettingsAction, type HolidayReturnsState } from "../../return-actions";

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

const dayLabel = (d: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/** Longer returns for orders paid in a holiday stretch. Submitted by hand so React doesn't reset the fields after an error. */
export function HolidayReturnsForm({ holiday, defaults }: { holiday: { from: string; to: string; until: string } | null; defaults: { from: string; to: string; until: string } }) {
  const [state, action, pending] = useActionState(holidayReturnsAction, {} as HolidayReturnsState);
  const [on, setOn] = useState(holiday !== null);
  const value = holiday ?? defaults;
  return (
    <form
      className="flex flex-col gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved !== undefined && !pending && !state.error && (
        <p role="status" className="banner banner-success">
          {state.saved
            ? `Saved. Orders paid from ${dayLabel(state.saved.from)} to ${dayLabel(state.saved.to)} can be returned until ${dayLabel(state.saved.until)}.`
            : "Saved. Holiday orders have the usual return window."}
        </p>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Longer returns for holiday orders
      </label>
      {on && (
        <div className="flex flex-wrap gap-3 items-end">
          <div className="field w-44">
            <label className="label" htmlFor="holiday-from">First order day</label>
            <input className="input" id="holiday-from" name="from" type="date" defaultValue={value.from} required />
          </div>
          <div className="field w-44">
            <label className="label" htmlFor="holiday-to">Last order day</label>
            <input className="input" id="holiday-to" name="to" type="date" defaultValue={value.to} required />
          </div>
          <div className="field w-44">
            <label className="label" htmlFor="holiday-until">Returns open until</label>
            <input className="input" id="holiday-until" name="until" type="date" defaultValue={value.until} required />
          </div>
        </div>
      )}
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save holiday returns"}</button>
      </div>
    </form>
  );
}

function Choice({ value, children, className }: { value: string; children: React.ReactNode; className: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" name="decision" value={value} className={className} disabled={pending} aria-busy={pending}>{children}</button>;
}

/** `gift`: the recipient sent it back, so only store credit (or approve, or decline) keeps it from the buyer. */
export function DecideForm({ id, approved, gift = false, exchange, amount, max }: { id: string; approved: boolean; gift?: boolean; exchange: boolean; amount: string; max: string }) {
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
          <label className="label" htmlFor={`message-${id}`}>{gift ? "Message to them" : "Message to the buyer"}</label>
          <textarea className="input" id={`message-${id}`} name="message" rows={2} maxLength={1000}
            placeholder={approved ? "Optional" : "Optional for approving (your usual instructions are sent). Needed to decline."} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {exchange && <Choice value="exchange" className="btn btn-primary">Send the exchange</Choice>}
        {!approved && <Choice value="approve" className="btn btn-secondary">Approve</Choice>}
        {!gift && <Choice value="refund" className={exchange ? "btn btn-secondary" : "btn btn-primary"}>Refund</Choice>}
        <Choice value="credit" className={gift ? "btn btn-primary" : "btn btn-secondary"}>Give store credit</Choice>
        {!gift && <Choice value="replace" className="btn btn-secondary">Send a replacement</Choice>}
        <Choice value="decline" className="btn btn-secondary text-critical">Decline</Choice>
      </div>
    </form>
  );
}
