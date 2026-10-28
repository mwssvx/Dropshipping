"use client";
import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { setBirthdayAction } from "./actions";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Month and day of the buyer's birthday ("07-14"), or nothing yet. */
export function BirthdayForm({ handle, birthday }: { handle: string; birthday: string | null }) {
  const [state, action] = useActionState(setBirthdayAction.bind(null, handle), {});
  const [month, day] = birthday?.split("-").map(Number) ?? [];
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.error && <p className="banner banner-critical" role="alert">{state.error}</p>}
      {state.saved && <p className="banner banner-info" role="status">Saved.</p>}
      <div className="flex flex-wrap items-end gap-3">
        <div className="field">
          <label className="label" htmlFor="bday-month">Month</label>
          <select className="input" id="bday-month" name="month" defaultValue={month ?? ""} key={`m-${birthday}`}>
            <option value="">Month</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="bday-day">Day</label>
          <select className="input" id="bday-day" name="day" defaultValue={day ?? ""} key={`d-${birthday}`}>
            <option value="">Day</option>
            {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
          </select>
        </div>
        <SubmitButton className="btn btn-primary" pendingText="Saving…">Save birthday</SubmitButton>
        {birthday && <button className="btn btn-secondary" name="intent" value="clear">Remove</button>}
      </div>
    </form>
  );
}
