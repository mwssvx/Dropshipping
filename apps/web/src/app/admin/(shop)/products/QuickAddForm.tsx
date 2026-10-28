"use client";
import { useActionState } from "react";
import { quickAddAction, type BadgeState } from "../../badge-actions";

/** The "Add to cart" button on product cards. */
export function QuickAddForm({ on }: { on: boolean }) {
  const [state, action, pending] = useActionState(quickAddAction, {} as BadgeState);
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.saved && !pending && <p className="banner banner-success" role="status">Saved. Your store&apos;s product cards follow it now.</p>}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="quickAdd" defaultChecked={on} />
        Show “Add to cart” on product cards
      </label>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save card setting"}</button>
      </div>
    </form>
  );
}
