"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { setBirthdayOfferAction } from "../../growth-actions";

type Offer = { percentOff: number; days: number } | null;

/** Submitted by hand so React doesn't reset the fields (and the checkbox) after an error. */
export function BirthdayForm({ offer }: { offer: Offer }) {
  const [state, action, pending] = useActionState(setBirthdayOfferAction, {});
  const [on, setOn] = useState(!!offer);
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
        <input type="checkbox" name="on" checked={on} onChange={(e) => setOn(e.target.checked)} /> Email subscribers a code on their birthday
      </label>
      {on && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="field">
            <label className="label" htmlFor="birthdayPercent">Birthday percent off</label>
            <input className="input num" id="birthdayPercent" name="percentOff" inputMode="numeric" required value={percent} onChange={(e) => setPercent(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="birthdayDays">Days to use the birthday code</label>
            <input className="input num" id="birthdayDays" name="days" inputMode="numeric" required value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
        </div>
      )}
      <div>
        <button className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save birthday codes"}</button>
      </div>
    </form>
  );
}
