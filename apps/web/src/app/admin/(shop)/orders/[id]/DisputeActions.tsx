"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { acceptDisputeAction, simulateDecisionAction, simulateDisputeAction, submitDisputeAction, type DisputeState } from "../../../dispute-actions";

/** Add a note and send the evidence, or accept the dispute (asked twice). */
export function DisputeResponse({ disputeId }: { disputeId: string }) {
  const [sent, send, sending] = useActionState(submitDisputeAction.bind(null, disputeId), {} as DisputeState);
  const [accepted, accept, accepting] = useActionState(acceptDisputeAction.bind(null, disputeId), {} as DisputeState);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const busy = sending || accepting;
  return (
    <div className="flex flex-col gap-3">
      <FormError message={sent.error ?? accepted.error} />
      {/* Submitted by hand so React doesn't clear the note after an error. */}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(() => send(data));
        }}
      >
        <div className="field">
          <label className="label" htmlFor="dispute-note">Anything to add (optional)</label>
          <textarea className="input min-h-24" id="dispute-note" name="note" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="For example: the buyer emailed us after delivery, or the item matched the photos." />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={sending}>{sending ? "Sending…" : "Send evidence"}</button>
          {confirming ? (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              The buyer keeps the money.
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => startTransition(() => accept())}>{accepting ? "Accepting…" : "Yes, accept dispute"}</button>
              <button type="button" className="hint hover:text-ink" onClick={() => setConfirming(false)}>Keep it open</button>
            </span>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)}>Accept dispute</button>
          )}
        </div>
      </form>
    </div>
  );
}

/** Test mode: a bank disputes this order, through the real webhook path. */
export function SimulateDispute({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(simulateDisputeAction.bind(null, orderId), {} as DisputeState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <FormError message={state.error} />
      <div className="field">
        <label className="label" htmlFor="sim-reason">Bank says</label>
        <select className="input" id="sim-reason" name="reason" defaultValue="product_not_received">
          <option value="product_not_received">It never arrived</option>
          <option value="fraudulent">Card was stolen</option>
          <option value="product_unacceptable">Not as described</option>
        </select>
      </div>
      <button className="btn btn-secondary" disabled={pending}>{pending ? "Opening…" : "Simulate a dispute"}</button>
    </form>
  );
}

/** Test mode: the bank decides. */
export function SimulateDecision({ disputeId }: { disputeId: string }) {
  const [won, win, winning] = useActionState(simulateDecisionAction.bind(null, disputeId, "won"), {} as DisputeState);
  const [lost, lose, losing] = useActionState(simulateDecisionAction.bind(null, disputeId, "lost"), {} as DisputeState);
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm">
      <FormError message={won.error ?? lost.error} />
      <span className="hint">Test mode: the bank decides</span>
      <form action={win}><button className="btn btn-secondary btn-sm" disabled={winning || losing}>Won</button></form>
      <form action={lose}><button className="btn btn-secondary btn-sm" disabled={winning || losing}>Lost</button></form>
    </div>
  );
}
