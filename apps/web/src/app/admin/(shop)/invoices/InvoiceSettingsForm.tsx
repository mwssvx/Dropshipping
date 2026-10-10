"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { invoiceSettingsAction, type InvoiceSettingsState } from "../../invoice-actions";

export function InvoiceSettingsForm({ initial }: { initial: NonNullable<InvoiceSettingsState["values"]> }) {
  const [state, action] = useActionState(invoiceSettingsAction, { values: initial } as InvoiceSettingsState);
  const v = state.values ?? initial;
  return (
    <form action={action} key={JSON.stringify(v)} className="flex flex-col gap-4">
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Invoice settings saved. New invoices use them.</p>}
      <div className="field">
        <label className="label" htmlFor="legalName">Registered business name</label>
        <input className="input" id="legalName" name="legalName" maxLength={120} defaultValue={v.legalName} placeholder="Glow Lamps LLC" />
      </div>
      <div className="field">
        <label className="label" htmlFor="address">Business address</label>
        <textarea className="input" id="address" name="address" maxLength={400} rows={3} defaultValue={v.address} />
        <span className="hint">Leave it empty to use the mailing address from your email settings.</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="field">
          <label className="label" htmlFor="prefix">Number prefix</label>
          <input className="input num" id="prefix" name="prefix" maxLength={12} defaultValue={v.prefix} />
        </div>
        <div className="field">
          <label className="label" htmlFor="nextNumber">Next number</label>
          <input className="input num" id="nextNumber" name="nextNumber" inputMode="numeric" defaultValue={v.nextNumber} required />
          <span className="hint">Moving from another shop? Continue its series here. Numbers can only go up.</span>
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="footer">Footer</label>
        <textarea className="input" id="footer" name="footer" maxLength={500} rows={2} defaultValue={v.footer} placeholder="Company number, bank details or a thank-you note" />
      </div>
      <SubmitButton className="btn btn-primary self-start">Save</SubmitButton>
    </form>
  );
}
