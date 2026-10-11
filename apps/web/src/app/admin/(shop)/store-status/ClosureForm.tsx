"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { storeClosureAction, type ClosureState } from "../../closure-actions";

const SAVED = {
  open: "Your store is open. Buyers can see everything and place orders.",
  password: "Your store is behind the password page. Give the password to anyone who should see it.",
  holiday: "Your store is on a break. Buyers can look around, but checkout is off until you're back.",
};

/** Open, behind a password, or on a break, with a message and an optional date to open again. */
export function ClosureForm({ mode, message, until, hasPassword, today }: { mode: "open" | "password" | "holiday"; message: string; until: string; hasPassword: boolean; today: string }) {
  const [state, action, pending] = useActionState(storeClosureAction, {} as ClosureState);
  const [picked, setPicked] = useState(mode);
  return (
    // Submitted by hand so React doesn't reset the fields after an error.
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved && !pending && !state.error && <p className="banner banner-success" role="status">{SAVED[state.saved]}</p>}
      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-1">Your store is</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="mode" value="open" checked={picked === "open"} onChange={() => setPicked("open")} className="mt-1" />
          <span><span className="font-medium">Open</span> <span className="hint">Anyone can visit and buy.</span></span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="mode" value="password" checked={picked === "password"} onChange={() => setPicked("password")} className="mt-1" />
          <span><span className="font-medium">Behind a password</span> <span className="hint">For before launch. Visitors see an “Opening soon” page where they can leave their email; people with the password can look around and place test orders. Search engines are kept out.</span></span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="mode" value="holiday" checked={picked === "holiday"} onChange={() => setPicked("holiday")} className="mt-1" />
          <span><span className="font-medium">On a break</span> <span className="hint">Buyers can look around and fill their cart, but can&apos;t check out. Every page says when you&apos;re back. Subscription deliveries carry on.</span></span>
        </label>
      </fieldset>
      {picked !== "open" && (
        <>
          {picked === "password" && (
            <div className="field max-w-sm">
              <label className="label" htmlFor="cl-password">Store password</label>
              <input className="input" id="cl-password" name="password" type="text" autoComplete="off" placeholder={hasPassword ? "Leave empty to keep the current one" : "At least 4 characters"} />
              <p className="hint">A new password lets out everyone who had the old one.</p>
            </div>
          )}
          <div className="field max-w-sm">
            <label className="label" htmlFor="cl-until">{picked === "password" ? "Open by itself on" : "Back on"} (optional)</label>
            <input className="input" id="cl-until" name="until" type="date" min={today} defaultValue={until} />
            <p className="hint">The store opens again on its own that morning (UTC). Leave empty to open it yourself.</p>
          </div>
          <div className="field">
            <label className="label" htmlFor="cl-message">Message for buyers (optional)</label>
            <textarea className="input" id="cl-message" name="message" rows={3} maxLength={500} defaultValue={message} placeholder={picked === "password" ? "Lamps that glow, from November." : "We're at a trade fair until the 20th. Orders placed before the break still ship as normal."} />
          </div>
        </>
      )}
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}
