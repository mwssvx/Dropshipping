"use client";
import { useActionState, useEffect, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../actions";
import type { PostState } from "../../blog-actions";

export type PostFields = { title: string; handle: string; excerpt: string; body: string; imageUrl: string; productIds: string[]; tags: string; published: boolean; publishAt: string };

/** An exact time as a datetime-local value in this browser's time zone, and back. */
const toLocal = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const toIso = (local: string) => (local ? new Date(local).toISOString() : "");

/** "Publish on": empty means as soon as it's saved with Published ticked. */
function PublishAt({ initial }: { initial: string }) {
  const [local, setLocal] = useState("");
  // The server doesn't know the merchant's time zone, so the value is filled in once in the browser.
  useEffect(() => setLocal(initial ? toLocal(initial) : ""), [initial]);
  return (
    <div className="field">
      <label className="label" htmlFor="publishAtLocal">Publish on (optional)</label>
      <input className="input" id="publishAtLocal" type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} aria-describedby="publish-at-hint" />
      <span className="hint" id="publish-at-hint">With Published ticked, the post goes up on the store at this time. Leave it empty to publish when you save.</span>
      <input type="hidden" name="publishAt" value={toIso(local)} />
    </div>
  );
}
type Product = { id: string; title: string };

export function PostForm({ action, initial: saved_, products, submitLabel, saved, drafted }: {
  action: (s: PostState, f: FormData) => Promise<PostState>;
  initial: PostFields;
  products: Product[];
  submitLabel: string;
  saved?: boolean;
  drafted?: boolean;
}) {
  const [state, formAction] = useActionState(action, (saved ? { saved: true } : {}) as PostState);
  const initial = state.values ?? saved_;
  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-[1fr_300px] items-start">
      <div className="flex flex-col gap-6 min-w-0">
        <FormError message={state.error} />
        {drafted && !state.saved && !state.error && (
          <p role="status" className="banner banner-info">The AI writer drafted this post. Read it over, change anything you like, then tick &ldquo;Published&rdquo; and save.</p>
        )}
        {state.saved && <p role="status" className="banner banner-info">Saved.</p>}
        <section className="card p-5 flex flex-col gap-4">
          <div className="field">
            <label className="label" htmlFor="title">Title</label>
            <input className="input" id="title" name="title" required maxLength={140} defaultValue={initial.title} placeholder="How to light a small room" />
          </div>
          <div className="field">
            <label className="label" htmlFor="body">Post</label>
            <textarea className="input font-[inherit] leading-relaxed" id="body" name="body" rows={20} defaultValue={initial.body} />
            <span className="hint">Leave a blank line between paragraphs. Start a line with &ldquo;## &rdquo; for a subheading and &ldquo;• &rdquo; or &ldquo;- &rdquo; for a bullet.</span>
          </div>
          <div className="field">
            <label className="label" htmlFor="excerpt">Summary</label>
            <textarea className="input" id="excerpt" name="excerpt" rows={2} maxLength={320} defaultValue={initial.excerpt} />
            <span className="hint">Shown on the blog page and in search results. Leave it empty to use the first paragraph.</span>
          </div>
        </section>
        {products.length > 0 && (
          <fieldset className="card p-5 flex flex-col gap-2">
            <legend className="font-semibold px-1">Products in this post</legend>
            <p className="hint">Shown under the post with a link to buy. Up to 8.</p>
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
              {products.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm py-1">
                  <input type="checkbox" name="productIds" value={p.id} defaultChecked={initial.productIds.includes(p.id)} /> {p.title}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>
      <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
        <section className="card p-4 flex flex-col gap-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="published" defaultChecked={initial.published} />
            Published
          </label>
          <PublishAt initial={initial.publishAt} />
          <div className="field">
            <label className="label" htmlFor="handle">Address</label>
            <div className="flex items-center gap-1">
              <span className="hint whitespace-nowrap">/blog/</span>
              <input className="input" id="handle" name="handle" maxLength={80} defaultValue={initial.handle} placeholder="made from the title" pattern="[a-z0-9](-?[a-z0-9])*" />
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="tags">Topics (optional)</label>
            <input className="input" id="tags" name="tags" maxLength={170} defaultValue={initial.tags} placeholder="Guides, News" aria-describedby="tags-hint" />
            <span className="hint" id="tags-hint">Up to 5, with commas between. Shoppers can read all the posts on one topic.</span>
          </div>
          <div className="field">
            <label className="label" htmlFor="imageUrl">Image address (optional)</label>
            <input className="input" id="imageUrl" name="imageUrl" type="url" defaultValue={initial.imageUrl} placeholder="https://…" />
          </div>
        </section>
        <SubmitButton className="btn btn-primary btn-lg">{submitLabel}</SubmitButton>
      </aside>
    </form>
  );
}

export function DraftWithAiForm({ action, products }: { action: (s: FormState, f: FormData) => Promise<FormState>; products: Product[] }) {
  const [state, formAction] = useActionState(action, {} as FormState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <FormError message={state.error} />
      <div className="field">
        <label className="label" htmlFor="topic">What should it be about?</label>
        <input className="input" id="topic" name="topic" required maxLength={300} placeholder="How to pick a night light for a kid's room" />
      </div>
      {products.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">Pick products to feature (optional)</summary>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 pt-2">
            {products.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm py-1">
                <input type="checkbox" name="productIds" value={p.id} /> {p.title}
              </label>
            ))}
          </div>
        </details>
      )}
      <SubmitButton className="btn btn-secondary self-start" pendingText="Writing… this can take a minute">Write a draft</SubmitButton>
    </form>
  );
}
