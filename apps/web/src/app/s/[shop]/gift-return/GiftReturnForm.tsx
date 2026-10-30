"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { giftReturnAction, type GiftReturnState } from "./actions";

type Line = { id: string; title: string; quantity: number };

/** What's going back and why, and where the store answers. Submitted by hand so nothing typed is lost after a mistake. */
export function GiftReturnForm({ handle, code, lines, reasons }: { handle: string; code: string; lines: Line[]; reasons: [string, string][] }) {
  const [state, action, pending] = useActionState(giftReturnAction.bind(null, handle, code), {} as GiftReturnState);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-1">What do you want to return?</legend>
        {lines.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-3 text-sm">
            <input type="hidden" name="lineId" value={l.id} />
            <label htmlFor={`qty-${l.id}`}>{l.title}</label>
            <select className="input w-24 num" id={`qty-${l.id}`} name={`qty-${l.id}`} defaultValue={lines.length === 1 ? l.quantity : 0}>
              {Array.from({ length: l.quantity + 1 }, (_, n) => <option key={n} value={n}>{n === 0 ? "None" : n}</option>)}
            </select>
          </div>
        ))}
      </fieldset>
      <div className="field">
        <label className="label" htmlFor="gift-reason">Why?</label>
        <select className="input" id="gift-reason" name="reason" required defaultValue="">
          <option value="" disabled>Pick a reason</option>
          {reasons.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor="gift-note">Anything the store should know? (optional)</label>
        <textarea className="input" id="gift-note" name="note" rows={3} maxLength={1000} />
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="field">
          <label className="label" htmlFor="gift-name">Your name</label>
          <input className="input" id="gift-name" name="name" required maxLength={60} autoComplete="name" />
        </div>
        <div className="field">
          <label className="label" htmlFor="gift-email">Your email</label>
          <input className="input" id="gift-email" name="email" type="email" required autoComplete="email" />
        </div>
      </div>
      <p className="hint text-sm">The store emails you what to do next, and your store credit once it&apos;s back.</p>
      <button className="btn btn-primary self-start" disabled={pending} aria-busy={pending}>{pending ? "Sending…" : "Ask to return it"}</button>
    </form>
  );
}
