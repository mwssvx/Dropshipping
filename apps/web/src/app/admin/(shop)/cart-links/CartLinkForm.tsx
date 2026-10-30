"use client";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { FormError } from "@/components/FormError";
import type { FormState } from "../../actions";
import { createCartLinkAction } from "../../cart-link-actions";

type Choice = { id: string; title: string; draft: boolean; variants: { id: string; title: string }[] };

/** Name, products with quantities, and an optional code. Submitted by hand so nothing typed is lost when it's refused. */
export function CartLinkForm({ choices, codes, max }: { choices: Choice[]; codes: string[]; max: number }) {
  const [state, action, pending] = useActionState(createCartLinkAction, {} as FormState);
  const [rows, setRows] = useState(1);
  const form = useRef<HTMLFormElement>(null);
  // A link that was made clears the form for the next one.
  useEffect(() => {
    if (state.saved) {
      form.current?.reset();
      setRows(1);
    }
  }, [state]);
  return (
    <form
      ref={form}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved && !pending && <p className="banner banner-success" role="status">Link made. It&apos;s at the top of the list below.</p>}
      <div className="field">
        <label className="label" htmlFor="link-name">Link name</label>
        <input className="input" id="link-name" name="name" maxLength={60} placeholder="Instagram bundle" required />
        <span className="hint">Only you see it. Sales through the link show as &quot;link-&quot; and this name under Sales by source.</span>
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex flex-wrap gap-2 items-end">
          <div className="field flex-1 min-w-56">
            <label className="label" htmlFor={`link-v${i}`}>Product {i + 1}</label>
            <select className="input" id={`link-v${i}`} name={`v${i}`} required={i === 0} defaultValue="">
              <option value="">Pick a product</option>
              {choices.map((p) =>
                p.variants.length === 1 ? (
                  <option key={p.id} value={p.variants[0]!.id}>{p.title}{p.draft ? " (draft)" : ""}</option>
                ) : (
                  <optgroup key={p.id} label={`${p.title}${p.draft ? " (draft)" : ""}`}>
                    {p.variants.map((v) => <option key={v.id} value={v.id}>{p.title} – {v.title}</option>)}
                  </optgroup>
                ),
              )}
            </select>
          </div>
          <div className="field w-24">
            <label className="label" htmlFor={`link-q${i}`}>How many</label>
            <input className="input num" id={`link-q${i}`} name={`q${i}`} type="number" min={1} max={99} defaultValue={1} />
          </div>
        </div>
      ))}
      {rows < max && (
        <div>
          <button type="button" className="btn btn-secondary" onClick={() => setRows((n) => n + 1)}>Add a product</button>
        </div>
      )}
      <div className="field max-w-xs">
        <label className="label" htmlFor="link-code">Code in the cart (optional)</label>
        <select className="input" id="link-code" name="code" defaultValue="">
          <option value="">No code</option>
          {codes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Making…" : "Make the link"}</button>
      </div>
    </form>
  );
}
