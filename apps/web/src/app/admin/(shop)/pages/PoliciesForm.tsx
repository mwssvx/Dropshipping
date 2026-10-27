"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { addPoliciesAction, type PolicyState } from "../../policy-actions";

type Draft = { kind: string; title: string; handle: string; body: string; existingId: string | null };

/** Store policies written from the store's settings, to read and add as pages. */
export function PoliciesForm({ drafts }: { drafts: Draft[] }) {
  const [state, action, pending] = useActionState(addPoliciesAction, {} as PolicyState);
  const missing = drafts.filter((d) => !d.existingId);
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
      {state.added && !pending && !state.error && (
        <p className="banner banner-success" role="status">{state.added.length ? `Added ${state.added.join(", ")}. Edit them any time below.` : "Those pages are already there."}</p>
      )}
      <ul className="flex flex-col gap-2">
        {drafts.map((d) => (
          <li key={d.kind} className="border border-border rounded-lg p-3 flex flex-col gap-2">
            <label className="flex items-center gap-2">
              {d.existingId ? (
                <span className="pill pill-success">Added</span>
              ) : (
                <input type="checkbox" name="kind" value={d.kind} defaultChecked />
              )}
              <span className="font-medium">{d.title}</span>
              <span className="hint text-sm">/pages/{d.handle}</span>
            </label>
            {!d.existingId && (
              <details>
                <summary className="cursor-pointer text-sm underline" aria-label={`Read ${d.title} first`}>Read it first</summary>
                <div className="mt-2 text-sm flex flex-col gap-2 whitespace-pre-line">{d.body.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)}</div>
              </details>
            )}
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <div>
          <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Adding…" : "Add policy pages"}</button>
        </div>
      )}
    </form>
  );
}
