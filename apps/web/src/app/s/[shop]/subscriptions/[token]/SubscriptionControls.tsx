"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { changeSubscriptionAction } from "../../actions";

/** Skip, change how often, pause or resume, and cancel (asked twice). */
export function SubscriptionControls({ handle, token, status, intervalDays, intervals }: {
  handle: string;
  token: string;
  status: "active" | "paused";
  intervalDays: number;
  intervals: { days: number; label: string }[];
}) {
  const [state, action, pending] = useActionState(changeSubscriptionAction.bind(null, handle, token), {});
  const [days, setDays] = useState(String(intervalDays));
  const [confirming, setConfirming] = useState(false);
  // Submitted by hand, with the button that was pressed, so React doesn't reset the choice.
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    setConfirming(false);
    startTransition(() => action(data));
  };
  return (
    <div className="flex flex-col gap-4">
      <FormError message={state.error} />
      {state.done && <p role="status" className="banner banner-info">{state.done}</p>}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="field">
          <label className="label" htmlFor="sub-every">How often</label>
          <select className="input" id="sub-every" name="intervalDays" value={days} onChange={(e) => setDays(e.target.value)}>
            {intervals.map((i) => <option key={i.days} value={i.days}>{i.label}</option>)}
          </select>
        </div>
        <button className="btn btn-secondary" name="change" value="interval" disabled={pending}>Save</button>
      </form>
      <form onSubmit={submit} className="flex flex-wrap gap-3">
        {status === "active" ? (
          <>
            <button className="btn btn-secondary" name="change" value="skip" disabled={pending}>Skip next delivery</button>
            <button className="btn btn-secondary" name="change" value="pause" disabled={pending}>Pause</button>
          </>
        ) : (
          <button className="btn btn-primary" name="change" value="resume" disabled={pending}>Resume</button>
        )}
        {confirming ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm">Cancel for good?</span>
            <button className="btn btn-primary" name="change" value="cancel" disabled={pending}>Yes, cancel subscription</button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>Keep it</button>
          </span>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)}>Cancel subscription</button>
        )}
      </form>
    </div>
  );
}
