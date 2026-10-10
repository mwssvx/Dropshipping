"use client";
import { useActionState } from "react";
import { cancelSubscriptionAction, sendNextDeliveryNowAction, type SubscriptionActionState } from "../../subscription-actions";

/** Cancel for the buyer, and in test mode, send the next delivery now. */
export function SubscriptionRowActions({ id, label, testMode, active }: { id: string; label: string; testMode: boolean; active: boolean }) {
  const [cancelState, cancel, cancelling] = useActionState(cancelSubscriptionAction.bind(null, id), {} as SubscriptionActionState);
  const [sendState, send, sending] = useActionState(sendNextDeliveryNowAction.bind(null, id), {} as SubscriptionActionState);
  const message = sendState.error ?? cancelState.error ?? sendState.done ?? cancelState.done;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {testMode && active && (
          <form action={send}><button className="btn btn-secondary btn-sm" disabled={sending} aria-label={`Send next delivery now for ${label}`}>{sending ? "Sending…" : "Send next delivery now"}</button></form>
        )}
        <form action={cancel}><button className="btn btn-secondary btn-sm" disabled={cancelling} aria-label={`Cancel subscription for ${label}`}>{cancelling ? "Cancelling…" : "Cancel"}</button></form>
      </div>
      {message && <p className={`text-sm ${sendState.error || cancelState.error ? "text-critical" : "hint"}`} role="status">{message}</p>}
    </div>
  );
}
