"use client";
import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { accountText } from "@/lib/account-text";
import { applyWholesaleAction } from "./actions";

export function WholesaleForm({ handle, company, lang }: { handle: string; company?: string | null; lang?: string | null }) {
  const t = accountText(lang).forms;
  const [state, action] = useActionState(applyWholesaleAction.bind(null, handle), {});
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.error && <p className="banner banner-critical" role="alert">{state.error}</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="field">
          <label className="label" htmlFor="ws-company">{t.company}</label>
          <input className="input" id="ws-company" name="company" defaultValue={company ?? ""} maxLength={120} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="ws-tax">{t.taxId}</label>
          <input className="input" id="ws-tax" name="taxId" maxLength={60} />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="ws-message">{t.wholesaleMessage}</label>
        <textarea className="input" id="ws-message" name="message" rows={3} maxLength={1000} />
      </div>
      <SubmitButton className="btn btn-primary self-start" pendingText={t.sending}>{t.applyWholesale}</SubmitButton>
    </form>
  );
}
