"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { reorderDaysAction, type ReorderDaysState } from "../../../customs-actions";

const CHOICES = [7, 14, 21, 30, 45, 60, 90, 120, 180];

/** How long the product usually lasts, so buyers get one "running low?" email that many days after it arrives. */
export function ReorderDaysForm({ productId, days }: { productId: string; days: number | null }) {
  const [state, action, pending] = useActionState(reorderDaysAction.bind(null, productId), {} as ReorderDaysState);
  const choices = days && !CHOICES.includes(days) ? [...CHOICES, days].sort((a, b) => a - b) : CHOICES;
  return (
    <form
      className="flex flex-wrap gap-3 items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      <div className="field w-56">
        <label className="label" htmlFor="reorder-days">It usually lasts</label>
        <select className="input" id="reorder-days" name="reorderDays" defaultValue={days ?? ""}>
          <option value="">No reminder</option>
          {choices.map((d) => (
            <option key={d} value={d}>{d} days</option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save reminder"}</button>
      {state.saved && !pending && !state.error && <p className="banner banner-success w-full" role="status">Saved.</p>}
    </form>
  );
}
