"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { customerNotesAction, eraseCustomerAction, sendPersonalCodeAction, taxExemptionAction, type CodeState, type ExemptionState, type NotesState } from "../../../customer-actions";

export function NotesForm({ id, note, tags }: { id: string; note: string; tags: string }) {
  const [state, action] = useActionState(customerNotesAction.bind(null, id), {} as NotesState);
  const values = { note: state.note ?? note, tags: state.tags ?? tags };
  return (
    // Keyed by the values so the fields show what was saved (or typed) after each try.
    <form action={action} className="flex flex-col gap-3" key={JSON.stringify(values)}>
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Saved.</p>}
      <div className="field">
        <label className="label" htmlFor="tags">Tags</label>
        <input className="input" id="tags" name="tags" defaultValue={values.tags} placeholder="vip, wholesale lead" maxLength={500} />
        <span className="hint">Separate with commas. Use them to find groups of customers later.</span>
      </div>
      <div className="field">
        <label className="label" htmlFor="note">Note</label>
        <textarea className="input" id="note" name="note" rows={3} maxLength={2000} defaultValue={values.note} placeholder="Only you and your team see this." />
      </div>
      <SubmitButton className="btn btn-secondary self-start">Save note and tags</SubmitButton>
    </form>
  );
}

export function EraseForm({ id, email }: { id: string; email: string }) {
  const [state, action] = useActionState(eraseCustomerAction.bind(null, id), {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      <div className="field max-w-md">
        <label className="label" htmlFor="confirm">Type their email to confirm</label>
        <input className="input" id="confirm" name="confirm" type="email" autoComplete="off" placeholder={email} required />
      </div>
      <SubmitButton className="btn btn-secondary text-critical self-start" pendingText="Erasing…">Erase their data</SubmitButton>
    </form>
  );
}

/** A one-time code for this customer, emailed with a message: to say sorry, or thanks. */
export function PersonalCodeForm({ id, currency }: { id: string; currency: string }) {
  const [state, action] = useActionState(sendPersonalCodeAction.bind(null, id), {} as CodeState);
  const [kind, setKind] = useState("percent");
  const symbol = new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? "";
  return (
    <form action={action} key={state.sent ?? "code"} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.sent && <p className="text-success" role="status">Sent {state.sent}.</p>}
      <div className="flex gap-2">
        <div className="field">
          <label className="label" htmlFor="codeKind">Off</label>
          <select className="input" id="codeKind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="percent">Percent</option>
            <option value="amount">Amount ({symbol})</option>
          </select>
        </div>
        <div className="field w-24">
          <label className="label" htmlFor="codeValue">{kind === "percent" ? "Percent" : "Amount"}</label>
          <input className="input num" id="codeValue" name="value" inputMode="decimal" defaultValue={kind === "percent" ? "10" : ""} key={kind} required />
        </div>
        <div className="field w-20">
          <label className="label" htmlFor="codeDays">Days</label>
          <input className="input num" id="codeDays" name="days" type="number" min={1} max={90} defaultValue={30} required />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="codeNote">Message (optional)</label>
        <textarea className="input" id="codeNote" name="note" rows={3} maxLength={500} placeholder="Sorry your parcel took so long. Here's something for next time." />
      </div>
      <SubmitButton className="btn btn-secondary self-start" pendingText="Sending…">Email them a code</SubmitButton>
      <span className="hint">It works once, only with their email.</span>
    </form>
  );
}

/** A buyer who doesn't pay tax: their certificate or resale number, kept on each order. */
export function TaxExemptionForm({ id, number }: { id: string; number: string | null }) {
  const [state, action] = useActionState(taxExemptionAction.bind(null, id), {} as ExemptionState);
  const current = state.saved ? state.number || null : number;
  return (
    <form action={action} className="flex flex-col gap-3" key={`${state.saved ?? ""}${current ?? ""}`}>
      <FormError message={state.error} />
      {state.saved && <p className="text-success" role="status">{state.saved === "set" ? "They pay no tax from now on." : "They pay tax again."}</p>}
      <div className="field">
        <label className="label" htmlFor="exemption">Exemption certificate or resale number</label>
        <input className="input" id="exemption" name="exemption" defaultValue={state.error ? state.number : (current ?? "")} maxLength={60} autoComplete="off" />
      </div>
      <div className="flex flex-wrap gap-2">
        <SubmitButton className="btn btn-secondary">{current ? "Save number" : "Make tax exempt"}</SubmitButton>
        {current && <button className="btn btn-secondary text-critical" name="intent" value="remove">Remove exemption</button>}
      </div>
    </form>
  );
}
