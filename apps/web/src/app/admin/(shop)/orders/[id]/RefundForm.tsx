"use client";
import { useActionState, useState } from "react";
import { formatMoney } from "@sf/core/money";
import { FormError } from "@/components/FormError";
import { refundAction } from "../../../money-actions";

export function RefundForm({ orderId, leftMinor, currency, feeNote }: { orderId: string; leftMinor: number; currency: string; feeNote: string | null }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(refundAction.bind(null, orderId), {});
  // The form closes on submit; the outcome (or the error) shows in its place.
  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {pending ? <p className="hint" role="status">Refunding…</p> : (
          <>
            <FormError message={state.error} />
            {state.message && <p className="banner banner-info" role="status">{state.message}</p>}
            {state.warning && <p className="banner banner-critical" role="alert">{state.warning}</p>}
          </>
        )}
        {leftMinor > 0 && !pending && <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>{state.error ? "Try again" : "Refund"}</button>}
      </div>
    );
  }
  return (
    <form action={action} onSubmit={() => setOpen(false)} className="flex flex-col gap-3">
      <div className="field">
        <label className="label" htmlFor="amount">Amount</label>
        <input className="input num" id="amount" name="amount" inputMode="decimal" placeholder={(leftMinor / 100).toFixed(2)} />
        <span className="hint">Leave empty to refund everything left ({formatMoney(leftMinor, currency)}). A full refund also cancels the supplier order if it hasn't shipped.</span>
      </div>
      <div className="field">
        <label className="label" htmlFor="reason">Reason</label>
        <input className="input" id="reason" name="reason" placeholder="Optional. The customer sees this." maxLength={500} />
      </div>
      {feeNote && <p className="hint">{feeNote}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary">Refund</button>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
