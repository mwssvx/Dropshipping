"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { createDiscountAction } from "../../growth-actions";

export function DiscountForm({ currency }: { currency: string }) {
  const [state, action] = useActionState(createDiscountAction, {});
  const [kind, setKind] = useState("percent");
  const symbol = new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? "";
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.saved && <p role="status" className="banner banner-info">Code created. Buyers can use it now.</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="field">
          <label className="label" htmlFor="code">Code</label>
          <input className="input font-mono uppercase" id="code" name="code" required maxLength={30} placeholder="WELCOME10" autoCapitalize="characters" />
        </div>
        <div className="field">
          <label className="label" htmlFor="kind">Type</label>
          <select className="input" id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="percent">Percent off</option>
            <option value="amount">Amount off</option>
            <option value="free_shipping">Free shipping</option>
          </select>
        </div>
        {kind !== "free_shipping" && (
          <div className="field">
            <label className="label" htmlFor="value">{kind === "percent" ? "Percent" : `Amount (${symbol})`}</label>
            <input className="input num" id="value" name="value" required inputMode="decimal" placeholder={kind === "percent" ? "10" : "5.00"} />
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="field">
          <label className="label" htmlFor="minSubtotal">Minimum order ({symbol})</label>
          <input className="input num" id="minSubtotal" name="minSubtotal" inputMode="decimal" placeholder="Optional" />
        </div>
        <div className="field">
          <label className="label" htmlFor="startsAt">Starts</label>
          <input className="input" id="startsAt" name="startsAt" type="date" />
        </div>
        <div className="field">
          <label className="label" htmlFor="endsAt">Ends</label>
          <input className="input" id="endsAt" name="endsAt" type="date" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 items-end">
        <div className="field">
          <label className="label" htmlFor="usageLimit">Total uses</label>
          <input className="input num" id="usageLimit" name="usageLimit" inputMode="numeric" placeholder="No limit" />
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2 pb-2">
          <input type="checkbox" name="oncePerCustomer" /> Once per buyer
        </label>
      </div>
      <div><SubmitButton pendingText="Creating…">Create code</SubmitButton></div>
    </form>
  );
}
