"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { setWelcomeOfferAction } from "../../growth-actions";

type Offer = { percentOff: number; minSubtotalMinor: number; days: number } | null;

/** Controlled fields, so what the merchant typed stays after an error. */
export function WelcomeOfferForm({ offer, currency }: { offer: Offer; currency: string }) {
  const [state, action] = useActionState(setWelcomeOfferAction, {});
  const [on, setOn] = useState(!!offer);
  const [percent, setPercent] = useState(String(offer?.percentOff ?? 10));
  const [min, setMin] = useState(offer?.minSubtotalMinor ? (offer.minSubtotalMinor / 100).toFixed(2) : "");
  const [days, setDays] = useState(String(offer?.days ?? 30));
  const symbol = new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? "";
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.saved && <p role="status" className="banner banner-info">{on ? "Saved. New signups get a code from now on." : "Turned off. Codes already sent still work."}</p>}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="on" checked={on} onChange={(e) => setOn(e.target.checked)} /> Email new signups a personal code
      </label>
      {on && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="field">
            <label className="label" htmlFor="welcomePercent">Percent off</label>
            <input className="input num" id="welcomePercent" name="percentOff" inputMode="numeric" required value={percent} onChange={(e) => setPercent(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="welcomeMin">Minimum order ({symbol})</label>
            <input className="input num" id="welcomeMin" name="minSubtotal" inputMode="decimal" placeholder="Optional" value={min} onChange={(e) => setMin(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="welcomeDays">Days to use it</label>
            <input className="input num" id="welcomeDays" name="days" inputMode="numeric" required value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
        </div>
      )}
      <div><SubmitButton pendingText="Saving…">Save welcome offer</SubmitButton></div>
    </form>
  );
}
