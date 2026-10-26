"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { createPartnerAction, partnerPayoutAction, type PartnerState, type PayoutState } from "../../partner-actions";

export function PartnerForm() {
  const [state, action] = useActionState(createPartnerAction, {} as PartnerState);
  return (
    <form action={action} key={state.added ?? "new"} className="flex flex-col gap-4">
      <FormError message={state.error} />
      {state.added && <p className="banner banner-success" role="status">{state.added} is set up.</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="field">
          <label className="label" htmlFor="partnerName">Name</label>
          <input className="input" id="partnerName" name="name" maxLength={80} placeholder="Maya Creates" required />
        </div>
        <div className="field">
          <label className="label" htmlFor="partnerEmail">Email (optional)</label>
          <input className="input" id="partnerEmail" name="email" type="email" placeholder="maya@example.com" />
          <span className="hint">We send them their code and private link.</span>
        </div>
        <div className="field">
          <label className="label" htmlFor="partnerCode">Their code</label>
          <input className="input uppercase" id="partnerCode" name="code" maxLength={30} placeholder="MAYA15" required />
        </div>
        <div className="field">
          <label className="label" htmlFor="partnerOff">Buyers get (% off)</label>
          <input className="input num" id="partnerOff" name="percentOff" type="number" min={1} max={50} defaultValue={10} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="partnerShare">They get (% of the items)</label>
          <input className="input num" id="partnerShare" name="commission" type="number" min={0} max={50} step={0.5} defaultValue={10} required />
          <span className="hint">Of what buyers pay for items, after the discount. Not shipping or tax.</span>
        </div>
      </div>
      <SubmitButton className="btn btn-primary self-start">Add partner</SubmitButton>
    </form>
  );
}

export function PayoutForm({ id, name, owed }: { id: string; name: string; owed: string }) {
  const [state, action] = useActionState(partnerPayoutAction.bind(null, id), {} as PayoutState);
  return (
    <form action={action} key={state.saved ?? "payout"} className="flex flex-col gap-2" aria-label={`Record a payment to ${name}`}>
      <FormError message={state.error} />
      {state.saved && <p className="text-sm text-success" role="status">{state.saved}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <div className="field w-28">
          <label className="label" htmlFor={`amount-${id}`}>Paid</label>
          <input className="input num" id={`amount-${id}`} name="amount" inputMode="decimal" defaultValue={owed} required />
        </div>
        <div className="field flex-1 min-w-40">
          <label className="label" htmlFor={`note-${id}`}>Note (optional)</label>
          <input className="input" id={`note-${id}`} name="note" maxLength={200} placeholder="PayPal, March" />
        </div>
        <SubmitButton className="btn btn-secondary">Record payment</SubmitButton>
      </div>
    </form>
  );
}
