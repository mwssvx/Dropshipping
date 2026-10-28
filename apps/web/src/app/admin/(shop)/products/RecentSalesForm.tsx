"use client";
import { useActionState } from "react";
import { recentSalesAction, type BadgeState } from "../../badge-actions";

/** "12 sold in the last 7 days" on product pages. */
export function RecentSalesForm({ on }: { on: boolean }) {
  const [state, action, pending] = useActionState(recentSalesAction, {} as BadgeState);
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.saved && !pending && <p className="banner banner-success" role="status">Saved. Your product pages follow it now.</p>}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="recentSales" defaultChecked={on} />
        Show how many sold in the last week
      </label>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save sales setting"}</button>
      </div>
    </form>
  );
}
