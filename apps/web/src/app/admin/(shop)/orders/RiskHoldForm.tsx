"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { setRiskHoldAction } from "../../actions";

export function RiskHoldForm({ value, options }: { value: string; options: [string, string][] }) {
  const [hold, setHold] = useState(value);
  const [state, action] = useActionState(setRiskHoldAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="field">
        <label className="label" htmlFor="hold">Risky orders</label>
        <select className="input" id="hold" name="hold" value={hold} onChange={(e) => setHold(e.target.value)}>
          {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>
      <SubmitButton className="btn btn-secondary" pendingText="Saving…">Save</SubmitButton>
      {state.saved && <span className="hint" role="status">Saved.</span>}
      <FormError message={state.error} />
    </form>
  );
}
