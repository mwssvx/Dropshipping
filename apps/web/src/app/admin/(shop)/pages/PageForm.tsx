"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../actions";

export function PageForm({
  action,
  initial,
  submitLabel,
  saved,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  initial: { title: string; handle: string; body: string; seoDescription: string; published: boolean };
  submitLabel: string;
  saved?: boolean;
}) {
  const [state, formAction] = useActionState(action, saved ? { saved: true } : {});
  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-[1fr_300px] items-start">
      <div className="flex flex-col gap-6 min-w-0">
        <FormError message={state.error} />
        {state.saved && <p role="status" className="banner banner-info">Saved.</p>}
        <section className="card p-5 flex flex-col gap-4">
          <div className="field">
            <label className="label" htmlFor="title">Title</label>
            <input className="input" id="title" name="title" required maxLength={120} defaultValue={initial.title} placeholder="Shipping and returns" />
          </div>
          <div className="field">
            <label className="label" htmlFor="body">Text</label>
            <textarea className="input" id="body" name="body" rows={14} defaultValue={initial.body} />
            <span className="hint">Leave a blank line between paragraphs.</span>
          </div>
        </section>
      </div>
      <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
        <section className="card p-4 flex flex-col gap-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="published" defaultChecked={initial.published} />
            Visible in the store
          </label>
          <div className="field">
            <label className="label" htmlFor="handle">Address</label>
            <div className="flex items-center gap-1">
              <span className="hint whitespace-nowrap">/pages/</span>
              <input className="input" id="handle" name="handle" maxLength={60} defaultValue={initial.handle} placeholder="made from the title" pattern="[a-z0-9](-?[a-z0-9])*" />
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="seoDescription">Search description</label>
            <textarea className="input" id="seoDescription" name="seoDescription" rows={3} maxLength={320} defaultValue={initial.seoDescription} />
            <span className="hint">Shown under the title in search results.</span>
          </div>
        </section>
        <SubmitButton className="btn btn-primary btn-lg">{submitLabel}</SubmitButton>
      </aside>
    </form>
  );
}
