"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { setReferralProgramAction } from "../../growth-actions";

type Program = { friendPercentOff: number; rewardMinor: number; minSubtotalMinor: number } | null;

/** Controlled fields, so what the merchant typed stays after an error. */
export function ReferralForm({ program, currency }: { program: Program; currency: string }) {
  const [state, action] = useActionState(setReferralProgramAction, {});
  const [on, setOn] = useState(!!program);
  const [percent, setPercent] = useState(String(program?.friendPercentOff ?? 10));
  const [reward, setReward] = useState(((program?.rewardMinor ?? 1000) / 100).toFixed(2));
  const [min, setMin] = useState(program?.minSubtotalMinor ? (program.minSubtotalMinor / 100).toFixed(2) : "");
  const symbol = new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? "";
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.saved && <p role="status" className="banner banner-info">{on ? "Saved. Buyers see their link on their order page and account." : "Turned off. Friends' codes already sent still work, but no more credit is sent."}</p>}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="on" checked={on} onChange={(e) => setOn(e.target.checked)} /> Let buyers refer friends
      </label>
      {on && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="field">
            <label className="label" htmlFor="referPercent">Friend&apos;s percent off</label>
            <input className="input num" id="referPercent" name="percentOff" inputMode="numeric" required value={percent} onChange={(e) => setPercent(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="referReward">Credit for the buyer ({symbol})</label>
            <input className="input num" id="referReward" name="reward" inputMode="decimal" required value={reward} onChange={(e) => setReward(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="referMin">Friend&apos;s minimum order ({symbol})</label>
            <input className="input num" id="referMin" name="minSubtotal" inputMode="decimal" placeholder="Optional" value={min} onChange={(e) => setMin(e.target.value)} />
          </div>
        </div>
      )}
      <div><SubmitButton pendingText="Saving…">Save refer a friend</SubmitButton></div>
    </form>
  );
}
