"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { setSignupPopupAction } from "../../growth-actions";

export function SignupPopupForm({ seconds, choices }: { seconds: number | null; choices: readonly number[] }) {
  const [state, action] = useActionState(setSignupPopupAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <FormError message={state.error} />
      <div className="field">
        <label className="label" htmlFor="popupSeconds">Show the pop-up</label>
        <select className="input" id="popupSeconds" name="seconds" defaultValue={seconds ?? ""}>
          <option value="">Never</option>
          <option value="0">When a visitor is about to leave (after 30 seconds on phones)</option>
          {choices.map((s) => <option key={s} value={s}>{s} seconds after a visitor arrives</option>)}
        </select>
      </div>
      <SubmitButton className="btn btn-primary" pendingText="Saving…">Save pop-up</SubmitButton>
      {state.saved && <p role="status" className="text-sm">Saved.</p>}
    </form>
  );
}
