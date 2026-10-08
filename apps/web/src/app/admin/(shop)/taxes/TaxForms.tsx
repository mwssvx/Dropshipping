"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { addTaxRegistrationAction } from "../../money-actions";

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
