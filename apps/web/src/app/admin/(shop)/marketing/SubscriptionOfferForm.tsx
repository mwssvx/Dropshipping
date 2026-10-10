"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { setSubscriptionOfferAction } from "../../growth-actions";

/** Controlled fields, so what the merchant typed stays after an error. */
export function SubscriptionOfferForm({ offer }: { offer: { percentOff: number; active: boolean } | null }) {
  const [state, action] = useActionState(setSubscriptionOfferAction, {});
  const [on, setOn] = useState(!!offer?.active);
  const [percent, setPercent] = useState(String(offer?.percentOff ?? 10));
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.saved && <p role="status" className="banner banner-info">{on ? "Saved. Buyers see the offer on their order page after paying." : "Turned off. Existing subscriptions carry on."}</p>}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="on" checked={on} onChange={(e) => setOn(e.target.checked)} /> Let buyers subscribe to their order
      </label>
      <div className="field max-w-40">
        <label className="label" htmlFor="subPercent">Subscriber saves (%)</label>
        <input className="input num" id="subPercent" name="percentOff" inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value)} />
      </div>
      <div><SubmitButton pendingText="Saving…">Save subscribe and save</SubmitButton></div>
    </form>
  );
}
