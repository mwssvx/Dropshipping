"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { ChangeDayState } from "../../actions";

/** "Change the day" for a pickup or local delivery, folded away under the day it's on. */
export function ChangeDay({ action, day, dates, text }: { action: (state: ChangeDayState, form: FormData) => Promise<ChangeDayState>; day: string; dates: [string, string][]; text: { label: string; changeDay: string; saveDay: string; dayChanged: string } }) {
  const [state, formAction] = useActionState(action, {} as ChangeDayState);
  return (
    <details className="mt-1">
      <summary className="cursor-pointer underline w-fit">{text.changeDay}</summary>
      <form action={formAction} className="flex flex-wrap items-end gap-2 mt-2">
        <FormError message={state.error} />
        {state.done && <p role="status" className="w-full">{text.dayChanged}</p>}
        <div className="field">
          <label className="label" htmlFor="changeDay">{text.label}</label>
          <select className="input" id="changeDay" name="day" defaultValue={day} key={day}>
            {dates.map(([d, label]) => <option key={d} value={d}>{label}</option>)}
          </select>
        </div>
        <SubmitButton className="btn btn-secondary" pendingText="…">{text.saveDay}</SubmitButton>
      </form>
    </details>
  );
}
