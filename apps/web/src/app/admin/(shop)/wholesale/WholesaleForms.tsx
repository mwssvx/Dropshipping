"use client";
import { useActionState } from "react";
import { useFreshKey } from "@/components/useFreshKey";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../actions";
import { addWholesaleBuyerAction, decideWholesaleAction, wholesaleSettingsAction } from "../../wholesale-actions";

export function SettingsForm({ enabled, percentOff, minOrder }: { enabled: boolean; percentOff: number; minOrder: string }) {
  const [state, action] = useActionState(wholesaleSettingsAction, {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Wholesale settings saved.</p>}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" defaultChecked={enabled} />
        <span>Sell wholesale (buyers can apply from their account page)</span>
      </label>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="field">
          <label className="label" htmlFor="percentOff">Wholesale discount (%)</label>
          <input className="input num" id="percentOff" name="percentOff" type="number" min={1} max={80} defaultValue={percentOff} required />
          <span className="hint">Off every product, instead of quantity discounts.</span>
        </div>
        <div className="field">
          <label className="label" htmlFor="minOrder">Minimum order</label>
          <input className="input num" id="minOrder" name="minOrder" inputMode="decimal" defaultValue={minOrder} placeholder="0.00" />
          <span className="hint">Wholesale buyers can&apos;t check out below this. Leave empty for none.</span>
        </div>
      </div>
      <SubmitButton className="btn btn-primary self-start">Save</SubmitButton>
    </form>
  );
}

export function DecideButtons({ id, pending }: { id: string; pending: boolean }) {
  const [approveState, approve] = useActionState(decideWholesaleAction.bind(null, id, "approve"), {} as FormState);
  const [declineState, decline] = useActionState(decideWholesaleAction.bind(null, id, "decline"), {} as FormState);
  const [removeState, remove] = useActionState(decideWholesaleAction.bind(null, id, "remove"), {} as FormState);
  return (
    <div className="flex flex-col gap-2">
      <FormError message={approveState.error ?? declineState.error ?? removeState.error} />
      <div className="flex flex-wrap gap-2">
        {pending ? (
          <>
            <form action={approve}><SubmitButton className="btn btn-primary">Approve</SubmitButton></form>
            <form action={decline}><SubmitButton className="btn btn-secondary">Decline</SubmitButton></form>
          </>
        ) : (
          <form action={remove}><SubmitButton className="btn btn-secondary text-critical">Remove</SubmitButton></form>
        )}
      </div>
    </div>
  );
}

export function AddBuyerForm() {
  const [state, action] = useActionState(addWholesaleBuyerAction, {} as FormState);
  const freshKey = useFreshKey(state, "add");
  return (
    <form key={freshKey} action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Buyer added. They get wholesale prices when they sign in with that email.</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="field">
          <label className="label" htmlFor="ws-email">Buyer&apos;s email</label>
          <input className="input" id="ws-email" name="email" type="email" required />
        </div>
        <div className="field">
          <label className="label" htmlFor="ws-company">Business name</label>
          <input className="input" id="ws-company" name="company" maxLength={120} />
        </div>
      </div>
      <SubmitButton className="btn btn-secondary self-start">Add buyer</SubmitButton>
    </form>
  );
}
