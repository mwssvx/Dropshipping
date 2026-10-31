"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { setLateOrderAction, type LateOrderState } from "../../shipping-actions";

/** The "running late" email: its switch, after how many days, and the merchant's own words. Submitted by hand so React doesn't reset the fields after an error. */
export function LateOrderForm({ notice, days, max }: { notice: { days: number; message: string | null; transit?: boolean } | null; days: readonly number[]; max: number }) {
  const [state, action, pending] = useActionState(setLateOrderAction, {} as LateOrderState);
  const [on, setOn] = useState(notice !== null);
  return (
    <form
      className="flex flex-col gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved !== undefined && !pending && !state.error && (
        <p role="status" className="banner banner-success">
          {state.saved
            ? `Saved. Buyers hear from you when their order hasn't shipped ${state.saved.days} days after paying${state.saved.transit ? ", and when a shipped parcel is past its delivery date" : ""}.`
            : "Saved. Buyers don't get a running late email."}
        </p>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Email buyers when their order is running late
      </label>
      {on && (
        <>
          <div className="field w-60">
            <label className="label" htmlFor="late-days">When it hasn&apos;t shipped after</label>
            <select className="input" id="late-days" name="days" defaultValue={notice?.days ?? 7}>
              {days.map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </div>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="transit" className="mt-1" defaultChecked={notice?.transit ?? false} aria-describedby="late-transit-hint" />
            <span>
              Also when a shipped parcel is past its delivery date
              <span id="late-transit-hint" className="hint block">One &ldquo;still on its way&rdquo; email with the tracking, a day after the last day it should have arrived.</span>
            </span>
          </label>
          <div className="field">
            <label className="label" htmlFor="late-message">Add a few words (optional)</label>
            <textarea className="input" id="late-message" name="message" rows={3} maxLength={max} defaultValue={notice?.message ?? ""} placeholder="Our supplier is very busy before the holidays. Thank you for your patience!" />
          </div>
        </>
      )}
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save running late email"}</button>
      </div>
    </form>
  );
}
