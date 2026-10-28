"use client";
import { useActionState } from "react";
import { shareButtonsAction, type BadgeState } from "../../badge-actions";

/** Share buttons on product pages. */
export function ShareButtonsForm({ on }: { on: boolean }) {
  const [state, action, pending] = useActionState(shareButtonsAction, {} as BadgeState);
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.saved && !pending && <p className="banner banner-success" role="status">Saved. Your product pages follow it now.</p>}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="share" defaultChecked={on} />
        Show share buttons on product pages
      </label>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save share setting"}</button>
      </div>
    </form>
  );
}
