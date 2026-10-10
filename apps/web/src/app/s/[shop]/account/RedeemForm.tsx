"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { redeemPointsAction, type RedeemState } from "./actions";

export function RedeemForm({ handle, min, max }: { handle: string; min: number; max: number }) {
  const [state, action] = useActionState(redeemPointsAction.bind(null, handle), {} as RedeemState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormError message={state.error} />
      {state.message && <p className="banner banner-success" role="status">{state.message}</p>}
      {max >= min && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="field w-32">
            <label className="label" htmlFor="points">Points to use</label>
            <input className="input num" id="points" name="points" type="number" min={min} max={max} step={100} defaultValue={max} required />
          </div>
          <SubmitButton className="btn btn-primary" pendingText="Swapping…">Swap for store credit</SubmitButton>
        </div>
      )}
    </form>
  );
}
