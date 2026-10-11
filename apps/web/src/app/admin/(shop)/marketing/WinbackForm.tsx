"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { setWinbackOfferAction } from "../../growth-actions";

type Offer = { afterDays: number; percentOff: number; days: number } | null;

/** Submitted by hand so React doesn't reset the fields (and the checkbox) after an error. */
export function WinbackForm({ offer }: { offer: Offer }) {
  const [state, action, pending] = useActionState(setWinbackOfferAction, {});
  const [on, setOn] = useState(!!offer);
  const [after, setAfter] = useState(String(offer?.afterDays ?? 90));
  const [percent, setPercent] = useState(String(offer?.percentOff ?? 15));
  const [days, setDays] = useState(String(offer?.days ?? 14));
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
      {state.saved && !pending && <p role="status" className="banner banner-info">{on ? "Saved. Codes go out with the daily emails." : "Turned off. Codes already sent still work."}</p>}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="on" checked={on} onChange={(e) => setOn(e.target.checked)} /> Email a code to subscribers who haven&apos;t ordered in a while
      </label>
      {on && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="field">
            <label className="label" htmlFor="winbackAfter">After their last order</label>
            <select className="input" id="winbackAfter" name="afterDays" value={after} onChange={(e) => setAfter(e.target.value)}>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
              <option value="180">180 days</option>
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="winbackPercent">Percent off</label>
            <input className="input num" id="winbackPercent" name="percentOff" inputMode="numeric" required value={percent} onChange={(e) => setPercent(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="winbackDays">Days to use it</label>
            <input className="input num" id="winbackDays" name="days" inputMode="numeric" required value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
        </div>
      )}
      <div>
        <button className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save win-back emails"}</button>
      </div>
    </form>
  );
}
