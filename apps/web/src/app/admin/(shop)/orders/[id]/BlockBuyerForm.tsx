"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { blockOrderBuyerAction, type BlockState } from "../../../blocked-actions";

/** "Block this buyer": their email and delivery address can't check out again. */
export function BlockBuyerForm({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(blockOrderBuyerAction.bind(null, orderId), {} as BlockState);
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="btn btn-sm btn-secondary self-start" onClick={() => setOpen(true)}>Block this buyer</button>;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      <p className="hint">Their email and this delivery address won&apos;t be able to check out again. This order isn&apos;t changed.</p>
      <div className="field">
        <label className="label" htmlFor="block-why">Why (only you see this)</label>
        <input className="input" id="block-why" name="note" maxLength={200} placeholder="Chargeback on order #1001" />
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-sm btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Blocking…" : "Block buyer"}</button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
