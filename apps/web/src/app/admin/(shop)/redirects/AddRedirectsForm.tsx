"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { addRedirectsAction } from "../../redirect-actions";

export function AddRedirectsForm() {
  const [state, action] = useActionState(addRedirectsAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.message && <p role="status" className="banner banner-info">{state.message}</p>}
      {state.skipped && state.skipped.length > 0 && (
        <div className="banner banner-warning text-sm" role="alert">
          <p className="font-medium">{state.skipped.length === 1 ? "1 line wasn't added:" : `${state.skipped.length} lines weren't added:`}</p>
          <ul className="list-disc pl-5">
            {state.skipped.slice(0, 20).map((s, i) => <li key={i}><span className="font-mono">{s.line}</span>: {s.reason}</li>)}
          </ul>
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="lines">One per line: the old address, then where it goes</label>
        <textarea className="input font-mono text-sm" id="lines" name="lines" rows={5} key={state.text ?? ""} defaultValue={state.text ?? ""} required
          placeholder={"/products/old-lamp /products/sunset-lamp\nhttps://old-store.com/pages/about-us, /pages/about"} />
        <span className="hint">Paste from a spreadsheet or your old store&apos;s export. Full addresses work too; only the path is kept.</span>
      </div>
      <SubmitButton className="btn btn-secondary self-start" pendingText="Adding…">Add redirects</SubmitButton>
    </form>
  );
}
