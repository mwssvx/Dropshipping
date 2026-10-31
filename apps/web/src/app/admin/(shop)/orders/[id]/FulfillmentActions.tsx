"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { addTrackingAction, checkTrackingAction, deliveredByStoreAction, pickedUpAction, readyForPickupAction, retryOrderAction } from "../../../actions";

export function RetryButton({ orderId }: { orderId: string }) {
  const [state, action] = useActionState(retryOrderAction.bind(null, orderId), {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormError message={state.error} />
      <SubmitButton className="btn btn-primary" pendingText="Sending…">Try again</SubmitButton>
    </form>
  );
}

export function CheckTrackingButton({ orderId }: { orderId: string }) {
  const [state, action] = useActionState(checkTrackingAction.bind(null, orderId), {});
  return (
    <form action={action} className="flex items-center gap-3 flex-wrap">
      <SubmitButton className="btn btn-secondary" pendingText="Checking…">Check for tracking now</SubmitButton>
      {state.saved && <span className="hint" role="status">Checked just now.</span>}
      <FormError message={state.error} />
    </form>
  );
}

export function ManualTrackingForm({ orderId, primary, own }: { orderId: string; primary?: boolean; /** For the parcel of the store's own stock. */ own?: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(addTrackingAction.bind(null, orderId), {});
  if (!open) {
    return (
      <button type="button" className={`btn ${primary ? "btn-primary" : "btn-secondary"}`} onClick={() => setOpen(true)}>
        Add tracking yourself
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3 w-full">
      {own && <input type="hidden" name="own" value="1" />}
      <FormError message={state.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field">
          <label className="label" htmlFor="carrier">Carrier</label>
          <input className="input" id="carrier" name="carrier" required placeholder="USPS" />
        </div>
        <div className="field">
          <label className="label" htmlFor="trackingNumber">Tracking number</label>
          <input className="input num" id="trackingNumber" name="trackingNumber" required />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="trackingUrl">Tracking link</label>
        <input className="input" id="trackingUrl" name="trackingUrl" type="url" placeholder="Optional, https://…" />
      </div>
      <p className="hint">We email the customer their tracking as soon as you save.</p>
      <div className="flex gap-2">
        <SubmitButton pendingText="Saving…">Mark as shipped</SubmitButton>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

/** For an order the buyer picks up: tell them it's ready, then mark it picked up. */
export function PickupButtons({ orderId, ready }: { orderId: string; ready: boolean }) {
  const [readyState, readyAction] = useActionState(readyForPickupAction.bind(null, orderId), {});
  const [doneState, doneAction] = useActionState(pickedUpAction.bind(null, orderId), {});
  return (
    <div className="flex flex-col gap-2">
      <FormError message={readyState.error ?? doneState.error} />
      <div className="flex gap-2 flex-wrap">
        {!ready && (
          <form action={readyAction}>
            <SubmitButton pendingText="Emailing…">Ready for pickup</SubmitButton>
          </form>
        )}
        <form action={doneAction}>
          <SubmitButton className={`btn ${ready ? "btn-primary" : "btn-secondary"}`} pendingText="Saving…">Picked up</SubmitButton>
        </form>
      </div>
    </div>
  );
}

/** For an order the store delivers itself. */
export function DeliveredButton({ orderId }: { orderId: string }) {
  const [state, action] = useActionState(deliveredByStoreAction.bind(null, orderId), {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormError message={state.error} />
      <div>
        <SubmitButton pendingText="Saving…">Delivered</SubmitButton>
      </div>
    </form>
  );
}
