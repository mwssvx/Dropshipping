"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../actions";
import { saveLanguagesAction, saveTranslationAction, translateAction, type TranslateState } from "../../language-actions";

export function LanguagesForm({ options, enabled }: { options: { code: string; name: string; english: string }[]; enabled: string[] }) {
  const [state, action] = useActionState(saveLanguagesAction, {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Saved. Buyers can pick these languages at the bottom of the store.</p>}
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Languages</legend>
        <label className="flex gap-3 items-center text-sm opacity-70">
          <input type="checkbox" checked disabled /> English (your store&apos;s language)
        </label>
        {options.map((o) => (
          <label key={o.code} className="flex gap-3 items-center text-sm">
            <input type="checkbox" name="languages" value={o.code} defaultChecked={enabled.includes(o.code)} />
            {o.english} · {o.name}
          </label>
        ))}
      </fieldset>
      <SubmitButton className="btn btn-primary self-start" pendingText="Saving…">Save</SubmitButton>
    </form>
  );
}

/** Stays on the page once everything is translated, so the last result is still there to read. */
export function TranslateButton({ language, label, complete }: { language: string; label: string; complete: boolean }) {
  const [state, action] = useActionState(translateAction.bind(null, language), {} as TranslateState);
  if (complete && !state.message && !state.error) return null;
  return (
    <form action={action} className="flex flex-col gap-2 items-start">
      {!complete && <SubmitButton className="btn btn-secondary" pendingText="Translating…">{label}</SubmitButton>}
      {state.message && <p className="text-sm" role="status">{state.message}</p>}
      {state.error && <p className="text-sm text-critical" role="alert">{state.error}</p>}
    </form>
  );
}

/** One item's original text beside its translation. Long fields get a text box, short ones a line. */
export function TranslationForm({ language, kind, refId, rows }: { language: string; kind: string; refId: string; rows: { key: string; label: string; original: string; value: string }[] }) {
  const [state, action] = useActionState(saveTranslationAction.bind(null, language, kind, refId), {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-5">
      <FormError message={state.error} />
      {rows.map((r, n) => {
        const long = r.original.length > 90 || r.original.includes("\n");
        return (
          <div key={n} className="grid gap-2 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="label">{r.label}</span>
              <p className="text-sm whitespace-pre-line rounded-md bg-sunken p-3 max-h-64 overflow-auto">{r.original}</p>
            </div>
            <div className="field">
              <label className="label" htmlFor={`v${n}`}>{r.label}, translated</label>
              <input type="hidden" name={`k${n}`} value={r.key} />
              {long ? (
                <textarea className="input min-h-32" id={`v${n}`} name={`v${n}`} defaultValue={r.value} rows={Math.min(14, Math.max(4, Math.ceil(r.original.length / 70)))} />
              ) : (
                <input className="input" id={`v${n}`} name={`v${n}`} defaultValue={r.value} />
              )}
            </div>
          </div>
        );
      })}
      <p className="hint text-sm">Leave a box empty to show the original there. Emptying every box removes the translation.</p>
      <SubmitButton className="btn btn-primary self-start" pendingText="Saving…">Save translation</SubmitButton>
    </form>
  );
}
