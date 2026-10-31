"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { moveHandoverDayAction, type FormState } from "../../../actions";

/** Moves a pickup or local delivery to another day; the buyer is emailed the new one. */
export function MoveDayForm({ orderId, day, dates }: { orderId: string; day: string; dates: [string, string][] }) {
  const [state, action] = useActionState(moveHandoverDayAction.bind(null, orderId), {} as FormState);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer underline w-fit">Move to another day</summary>
      <form action={action} className="flex flex-wrap items-end gap-2 mt-2">
        <FormError message={state.error} />
        {state.saved && <p role="status" className="w-full banner banner-success">Moved. The buyer was emailed the new day.</p>}
        <div className="field">
          <label className="label" htmlFor="move-day">New day</label>
          <select className="input" id="move-day" name="day" defaultValue={day} key={day}>
            {dates.map(([d, label]) => <option key={d} value={d}>{label}</option>)}
          </select>
        </div>
        <SubmitButton className="btn btn-secondary" pendingText="Moving…">Move and tell the buyer</SubmitButton>
      </form>
    </details>
  );
}
