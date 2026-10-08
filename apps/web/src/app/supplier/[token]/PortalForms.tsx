"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { cantSendAction, markShippedAction, type PortalState } from "./actions";

export function ShipForm({ token, id, reasons }: { token: string; id: string; reasons: Record<string, string> }) {
  const [shipped, ship] = useActionState(markShippedAction.bind(null, token, id), {} as PortalState);
  const [refused, refuse] = useActionState(cantSendAction.bind(null, token, id), {} as PortalState);
  const done = shipped.done ?? refused.done;
  if (done) return <p className="banner banner-success" role="status">{done}</p>;
  return (
    <div className="flex flex-col gap-3">
      <form action={ship} className="flex flex-col gap-3">
        <FormError message={shipped.error} />
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="field">
            <label className="label" htmlFor={`carrier-${id}`}>Carrier</label>
            <input className="input" id={`carrier-${id}`} name="carrier" placeholder="USPS" required />
          </div>
          <div className="field">
            <label className="label" htmlFor={`tracking-${id}`}>Tracking number</label>
            <input className="input" id={`tracking-${id}`} name="trackingNumber" required />
          </div>
          <div className="field">
            <label className="label" htmlFor={`url-${id}`}>Tracking link (optional)</label>
            <input className="input" id={`url-${id}`} name="url" type="url" placeholder="https://" />
          </div>
        </div>
        <SubmitButton className="btn btn-primary self-start">Mark shipped</SubmitButton>
      </form>
      <details className="text-sm">
        <summary className="cursor-pointer hint">Can't send this order?</summary>
        <form action={refuse} className="flex flex-col gap-3 pt-3">
          <FormError message={refused.error} />
          <div className="field">
            <label className="label" htmlFor={`reason-${id}`}>Reason</label>
            <select className="input" id={`reason-${id}`} name="reason" defaultValue="out_of_stock">
              {Object.entries(reasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor={`note-${id}`}>Note for the store (optional)</label>
            <input className="input" id={`note-${id}`} name="note" placeholder="Back in stock on the 20th" maxLength={500} />
          </div>
          <SubmitButton className="btn btn-secondary self-start">Tell the store</SubmitButton>
        </form>
      </details>
    </div>
  );
}
