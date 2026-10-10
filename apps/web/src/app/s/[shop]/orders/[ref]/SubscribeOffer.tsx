"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { startSubscriptionAction } from "../../actions";

/** "Get this again every month for less", shown for a week after paying. */
export function SubscribeOffer({ handle, orderRef, percentOff, items, each, intervals }: {
  handle: string;
  orderRef: string;
  percentOff: number;
  items: { title: string; quantity: number; price: string; offer: string }[];
  each: string;
  intervals: { days: number; label: string }[];
}) {
  const [state, action, pending] = useActionState(startSubscriptionAction.bind(null, handle, orderRef), {});
  const [days, setDays] = useState(String(intervals.find((i) => i.days === 30)?.days ?? intervals[0]!.days));
  return (
    <section className="card p-5 flex flex-col gap-3" aria-labelledby="sub-heading">
      <div className="flex flex-col gap-1">
        <h2 id="sub-heading" className="font-semibold text-lg">Get this again automatically and save {percentOff}%</h2>
        <p className="text-sm text-muted">We&apos;ll send the same items on a schedule and charge the card you just used. You can skip, change or cancel any time.</p>
      </div>
      <ul className="text-sm flex flex-col gap-1" aria-label="Each delivery">
        {items.map((i) => (
          <li key={i.title} className="flex justify-between gap-3">
            <span>{i.quantity > 1 ? `${i.quantity} × ` : ""}{i.title}</span>
            <span className="num">{i.price !== i.offer && <s className="hint mr-2">{i.price}</s>}{i.offer}</span>
          </li>
        ))}
      </ul>
      {/* Submitted by hand so React doesn't reset the choice when there's an error. */}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(() => action(data));
        }}
      >
        <FormError message={state.error} />
        <div className="field max-w-xs">
          <label className="label" htmlFor="sub-interval">How often</label>
          <select className="input" id="sub-interval" name="intervalDays" value={days} onChange={(e) => setDays(e.target.value)}>
            {intervals.map((i) => <option key={i.days} value={i.days}>{i.label}</option>)}
          </select>
        </div>
        <button type="submit" className="btn btn-primary self-start" disabled={pending} aria-busy={pending}>{pending ? "Subscribing…" : `Subscribe and save ${percentOff}%`}</button>
        <p className="hint text-sm">About {each} each delivery with shipping, plus any tax. We email you 3 days before each charge.</p>
      </form>
    </section>
  );
}
