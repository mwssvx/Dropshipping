"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../actions";
import { adjustPointsAction, rewardsSettingsAction, type PointsState } from "../../reward-actions";

export function RewardsSettingsForm({ enabled, earnRate, value, currency }: { enabled: boolean; earnRate: number; value: string; currency: string }) {
  const [state, action] = useActionState(rewardsSettingsAction, {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Rewards settings saved.</p>}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" defaultChecked={enabled} />
        <span>Give buyers points on their orders</span>
      </label>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="field">
          <label className="label" htmlFor="earnRate">Points per 1.00 spent</label>
          <input className="input num" id="earnRate" name="earnRate" type="number" min={1} max={100} defaultValue={earnRate} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="value">100 points are worth ({currency})</label>
          <input className="input num" id="value" name="value" inputMode="decimal" defaultValue={value} required />
        </div>
      </div>
      <SubmitButton className="btn btn-primary self-start">Save</SubmitButton>
    </form>
  );
}

export function AdjustPointsForm({ customerId }: { customerId: string }) {
  const [state, action] = useActionState(adjustPointsAction.bind(null, customerId), {} as PointsState);
  return (
    <form action={action} key={state.message ?? "adjust"} className="flex flex-col gap-2">
      <FormError message={state.error} />
      {state.message && <p className="text-sm text-success" role="status">{state.message}</p>}
      <div className="flex gap-2">
        <div className="field w-24">
          <label className="label" htmlFor="points">Points</label>
          <input className="input num" id="points" name="points" inputMode="numeric" placeholder="100" required />
        </div>
        <div className="field flex-1">
          <label className="label" htmlFor="pointsNote">Note for them</label>
          <input className="input" id="pointsNote" name="note" maxLength={120} placeholder="Thanks for your patience" required />
        </div>
      </div>
      <span className="hint">A minus number takes points away.</span>
      <SubmitButton className="btn btn-secondary self-start">Save points</SubmitButton>
    </form>
  );
}
