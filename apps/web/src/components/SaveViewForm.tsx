"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { saveViewAction, type SaveViewState } from "@/app/admin/view-actions";
import type { SavedViewList } from "@sf/core";

/** Names the list's current search and filters, so the team can come back to them in one click. */
export function SaveViewForm({ list, params }: { list: SavedViewList; params: Record<string, string> }) {
  const [state, action, pending] = useActionState(saveViewAction.bind(null, list), {} as SaveViewState);
  return (
    <form action={action} className="flex flex-col gap-2 mt-2">
      {Object.entries(params).map(([k, v]) => <input key={k} type="hidden" name={`view-${k}`} value={v} />)}
      <div className="flex flex-wrap items-end gap-2">
        <div className="field">
          <label className="label" htmlFor={`view-name-${list}`}>Name for this view</label>
          <input className="input w-56" id={`view-name-${list}`} name="name" required maxLength={40} placeholder="Sold out" autoComplete="off" />
        </div>
        <button className="btn btn-secondary" disabled={pending}>Save view</button>
      </div>
      <p className="hint text-sm">Everyone on your team sees it here. Saving the same name again changes it.</p>
      <FormError message={state.error} />
      {state.done && <p className="banner banner-success" role="status">{state.done}.</p>}
    </form>
  );
}
