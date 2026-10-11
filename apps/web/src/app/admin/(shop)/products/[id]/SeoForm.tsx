"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { productSeoAction, type SeoState } from "../../../seo-actions";

/** Search title and description, with a preview of the result and how much room is left. */
export function SeoForm({ productId, title, description, fallback, url, max }: {
  productId: string;
  title: string;
  description: string;
  fallback: { title: string; description: string };
  url: string;
  max: { title: number; description: number };
}) {
  const [state, action, pending] = useActionState(productSeoAction.bind(null, productId), {} as SeoState);
  const [t, setT] = useState(title);
  const [d, setD] = useState(description);
  const shownTitle = t.trim() || fallback.title;
  const shownDescription = d.trim() || fallback.description;
  return (
    // Submitted by hand so React doesn't reset the fields after an error.
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved && !pending && !state.error && <p className="banner banner-success" role="status">Saved. Search engines pick it up next time they visit.</p>}
      <div className="rounded-md border border-border p-4 flex flex-col gap-1" aria-label="Search result preview">
        <span className="text-xs hint truncate">{url}</span>
        <span className="text-lg text-accent leading-snug">{shownTitle.length > max.title ? `${shownTitle.slice(0, max.title - 3)}...` : shownTitle}</span>
        <span className="text-sm text-muted">{shownDescription || "Search engines will pick some text from the page."}</span>
      </div>
      <div className="field">
        <label className="label" htmlFor="seo-title">Search title</label>
        <input className="input" id="seo-title" name="seoTitle" value={t} maxLength={max.title} placeholder={fallback.title} onChange={(e) => setT(e.target.value)} aria-describedby="seo-title-hint" />
        <span id="seo-title-hint" className="hint text-xs">{t.length} of {max.title} characters. Leave it empty to use the product title.</span>
      </div>
      <div className="field">
        <label className="label" htmlFor="seo-description">Search description</label>
        <textarea className="input" id="seo-description" name="seoDescription" rows={3} value={d} maxLength={max.description} placeholder={fallback.description} onChange={(e) => setD(e.target.value)} aria-describedby="seo-description-hint" />
        <span id="seo-description-hint" className="hint text-xs">{d.length} of {max.description} characters. Leave it empty to use the start of the description.</span>
      </div>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save search listing"}</button>
      </div>
    </form>
  );
}
