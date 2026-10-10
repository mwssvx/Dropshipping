"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { setSubscriptionOfferAction } from "../../growth-actions";

/** Controlled fields, submitted by hand so React doesn't reset the checkbox after an error. */
export function SubscriptionOfferForm({ offer }: { offer: { percentOff: number; active: boolean } | null }) {
  const [state, action, pending] = useActionState(setSubscriptionOfferAction, {});
  const [on, setOn] = useState(!!offer?.active);
  const [percent, setPercent] = useState(String(offer?.percentOff ?? 10));
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved && <p role="status" className="banner banner-info">{on ? "Saved. Buyers see the offer on their order page after paying." : "Turned off. Existing subscriptions carry on."}</p>}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="on" checked={on} onChange={(e) => setOn(e.target.checked)} /> Let buyers subscribe to their order
      </label>
      <div className="field max-w-40">
        <label className="label" htmlFor="subPercent">Subscriber saves (%)</label>
        <input className="input num" id="subPercent" name="percentOff" inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value)} />
      </div>
      <div><button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save subscribe and save"}</button></div>
    </form>
  );
}
