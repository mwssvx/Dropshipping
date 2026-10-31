"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { addTaxRegistrationAction, setDutiesAction } from "../../money-actions";

export function AddRegistrationForm({ options }: { options: { code: string; name: string }[] }) {
  const [state, action] = useActionState(addTaxRegistrationAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <div className="field">
          <label className="label" htmlFor="jurisdiction">Where you're registered</label>
          <select className="input" id="jurisdiction" name="jurisdiction" required defaultValue="">
            <option value="" disabled>Choose…</option>
            {options.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="registrationNumber">Registration number</label>
          <input className="input num" id="registrationNumber" name="registrationNumber" placeholder="Optional" maxLength={40} />
        </div>
      </div>
      <div><SubmitButton pendingText="Adding…">Add registration</SubmitButton></div>
    </form>
  );
}

/** What buyers abroad are told about import duties. */
export function DutiesForm({ value }: { value: "off" | "buyer_pays" | "included" }) {
  const [state, action] = useActionState(setDutiesAction, {});
  const options = [
    ["buyer_pays", "Buyers pay them on delivery", "Checkout tells buyers abroad that customs may charge duties or taxes when it arrives, so nobody refuses the parcel in surprise."],
    ["included", "They're included in my prices", "Checkout tells buyers abroad there's nothing more to pay when it arrives. Pick this only if you or your supplier pay them."],
    ["off", "Don't mention them", "Nothing is said at checkout."],
  ] as const;
  return (
    <form action={action} className="flex flex-col gap-2 text-sm">
      <FormError message={state.error} />
      {state.saved && <p role="status" className="banner banner-success">Saved. Checkout and your shipping policy follow it.</p>}
      {options.map(([v, label, hint]) => (
        <label key={v} className="flex gap-2 items-start">
          <input type="radio" name="duties" value={v} defaultChecked={value === v} className="mt-1" />
          <span><span className="font-medium">{label}</span> <span className="hint">· {hint}</span></span>
        </label>
      ))}
      <div><SubmitButton className="btn btn-secondary" pendingText="Saving…">Save import duties</SubmitButton></div>
    </form>
  );
}
