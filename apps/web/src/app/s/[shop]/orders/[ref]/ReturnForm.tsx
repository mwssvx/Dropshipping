"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { returnAction, type ReturnState } from "../../actions";

type Line = { id: string; title: string; quantity: number; swaps: { variantId: string; title: string }[] };

export type ReturnText = { title: string; until: string; what: string; none: string; instead: string; refundIt: string; swapFor: string; why: string; pick: string; note: string; notePlaceholder: string; sending: string; send: string };

export function ReturnForm({ handle, orderRef, lines, reasons, text: t }: { handle: string; orderRef: string; lines: Line[]; reasons: [string, string][]; closes: string | null; text: ReturnText }) {
  const [state, action] = useActionState(returnAction.bind(null, handle, orderRef), {} as ReturnState);
  return (
    <details className="group">
      <summary className="cursor-pointer font-medium">{t.title}{t.until ? <span className="hint font-normal">{t.until}</span> : null}</summary>
      <form action={action} className="flex flex-col gap-4 pt-4">
        <FormError message={state.error} />
        <fieldset className="flex flex-col gap-2">
          <legend className="label mb-1">{t.what}</legend>
          {lines.map((l) => (
            <div key={l.id} className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <input type="hidden" name="lineId" value={l.id} />
                <label htmlFor={`qty-${l.id}`}>{l.title}</label>
                <select className="input w-24 num" id={`qty-${l.id}`} name={`qty-${l.id}`} defaultValue={lines.length === 1 ? l.quantity : 0}>
                  {Array.from({ length: l.quantity + 1 }, (_, n) => <option key={n} value={n}>{n === 0 ? t.none : n}</option>)}
                </select>
              </div>
              {l.swaps.length > 0 && (
                <div className="flex items-center justify-between gap-3 pl-3">
                  <label htmlFor={`swap-${l.id}`} className="hint">{t.instead}</label>
                  <select className="input w-auto" id={`swap-${l.id}`} name={`swap-${l.id}`} defaultValue="">
                    <option value="">{t.refundIt}</option>
                    {l.swaps.map((s) => <option key={s.variantId} value={s.variantId}>{t.swapFor.replace("{title}", s.title)}</option>)}
                  </select>
                </div>
              )}
            </div>
          ))}
        </fieldset>
        <div className="field">
          <label className="label" htmlFor="return-reason">{t.why}</label>
          <select className="input" id="return-reason" name="reason" required defaultValue="">
            <option value="" disabled>{t.pick}</option>
            {reasons.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="return-note">{t.note}</label>
          <textarea className="input" id="return-note" name="note" rows={3} maxLength={1000} placeholder={t.notePlaceholder} />
        </div>
        <SubmitButton className="btn btn-primary self-start" pendingText={t.sending}>{t.send}</SubmitButton>
      </form>
    </details>
  );
}
