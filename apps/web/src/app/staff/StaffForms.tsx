"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { decideAppealAction, sendNoticeAction } from "./actions";

export function DecideAppealForm({ appealId }: { appealId: string }) {
  const [state, action] = useActionState(decideAppealAction.bind(null, appealId), {});
  if (state.saved) return <p className="banner banner-info" role="status">Decided. The merchant sees your reply on their Trust page.</p>;
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      <div className="field">
        <label className="label" htmlFor={`r-${appealId}`}>Reply to the merchant</label>
        <textarea className="input" id={`r-${appealId}`} name="response" required minLength={10} />
      </div>
      <div className="flex gap-2">
        <button type="submit" name="decision" value="accept" className="btn btn-primary">Accept</button>
        <button type="submit" name="decision" value="reject" className="btn btn-secondary">Reject</button>
      </div>
    </form>
  );
}

export function SendNoticeForm({ shopId, reasons }: { shopId: string; reasons: { value: string; title: string }[] }) {
  const [state, action] = useActionState(sendNoticeAction.bind(null, shopId), {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-info" role="status">Sent.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field">
          <label className="label" htmlFor="kind">Type</label>
          <select className="input" id="kind" name="kind" defaultValue="warning">
            <option value="warning">Warning (keeps selling)</option>
            <option value="paused">Pause the store</option>
            <option value="reinstated">Reopen the store</option>
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="reason">Reason</label>
          <select className="input" id="reason" name="reason">
            {reasons.map((r) => <option key={r.value} value={r.value}>{r.title}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="explanation">What happened (the merchant sees exactly this)</label>
        <textarea className="input" id="explanation" name="explanation" required minLength={20} />
      </div>
      <div className="field">
        <label className="label" htmlFor="whatToDo">What to do</label>
        <input className="input" id="whatToDo" name="whatToDo" placeholder="Leave empty for the standard advice for this reason" />
      </div>
      <div className="field">
        <label className="label" htmlFor="dueBy">Deadline (warnings)</label>
        <input className="input sm:w-auto" id="dueBy" name="dueBy" type="date" />
        <span className="hint">Defaults to 7 days.</span>
      </div>
      <div><SubmitButton pendingText="Sending…">Send notice</SubmitButton></div>
    </form>
  );
}
