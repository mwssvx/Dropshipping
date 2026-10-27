"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { bankTransferAction, type BankTransferState } from "../../bank-transfer-actions";

/** Whether buyers can pay by bank transfer, the account they pay into, and how long they have. */
export function BankTransferForm({ value, max, days }: { value: { details: string; days: number } | null; max: number; days: { min: number; max: number; default: number } }) {
  const [on, setOn] = useState(!!value);
  const [state, action] = useActionState(bankTransferAction, {} as BankTransferState);
  return (
    <form action={action} className="flex flex-col gap-3 max-w-xl">
      <FormError message={state.error} />
      {state.saved && !state.error && <p className="banner banner-success" role="status">{on ? "Saved. Buyers can now pay by bank transfer on the payment page." : "Saved. Buyers pay by card only."}</p>}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="on" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Let buyers pay by bank transfer
      </label>
      {on && (
        <>
          <div className="field">
            <label className="label" htmlFor="bank-details">Account to pay into</label>
            <textarea className="input" id="bank-details" name="details" rows={4} maxLength={max} required defaultValue={value?.details ?? ""}
              placeholder={"Name on the account\nIBAN, or account number and sort or routing number\nBank name and BIC (for payments from abroad)"} />
            <p className="hint text-sm">Buyers see this exactly as you write it, in their email and on their order page.</p>
          </div>
          <div className="field max-w-40">
            <label className="label" htmlFor="bank-days">Days to pay</label>
            <input className="input num" id="bank-days" name="days" type="number" min={days.min} max={days.max} required defaultValue={value?.days ?? days.default} />
          </div>
        </>
      )}
      <div><SubmitButton className="btn btn-secondary" pendingText="Saving…">Save bank transfers</SubmitButton></div>
    </form>
  );
}
