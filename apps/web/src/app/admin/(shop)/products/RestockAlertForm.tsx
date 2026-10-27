"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { restockAlertAction, type LowStockState } from "../../stock-actions";

/** When the team hears that an option of their own stock is running low. */
export function RestockAlertForm({ value }: { value: number }) {
  const [state, action, pending] = useActionState(restockAlertAction, {} as LowStockState);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved !== undefined && !pending && !state.error && (
        <p className="banner banner-success" role="status">
          {state.saved ? `Saved. We email you when an option has ${state.saved} or fewer left.` : "Saved. We won't email you about running low."}
        </p>
      )}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="field w-48">
          <label className="label" htmlFor="restockAlertAt">Email me at</label>
          <input className="input num" id="restockAlertAt" name="restockAlertAt" type="number" min={0} max={1000} defaultValue={value} aria-describedby="restockAlertAt-hint" />
        </div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save"}</button>
      </div>
      <p id="restockAlertAt-hint" className="hint text-sm">Or fewer left. 0 turns the email off.</p>
    </form>
  );
}
