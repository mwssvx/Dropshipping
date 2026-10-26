"use client";
import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { setBuyerCancelAction } from "../../actions";

export function BuyerCancelForm({ value, hours }: { value: boolean; hours: number }) {
  const [state, action] = useActionState(setBuyerCancelAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="buyerCancel" defaultChecked={value} />
        Let buyers cancel their order from its page in the first {hours} hours, before it ships. Supplier orders are stopped and the buyer is refunded in full.
      </label>
      <SubmitButton className="btn btn-secondary" pendingText="Saving…">Save</SubmitButton>
      {state.saved && <span className="hint" role="status">Saved.</span>}
    </form>
  );
}
