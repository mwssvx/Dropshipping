"use client";
import { useActionState, useState } from "react";
import { useFreshKey } from "@/components/useFreshKey";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../actions";
import { addOwnSupplierAction, removeOwnSupplierAction, resetSupplierLinkAction, updateOwnSupplierAction } from "../../supplier-actions";

function Fields({ name, email }: { name?: string; email?: string }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <div className="field">
        <label className="label" htmlFor={`name-${email ?? "new"}`}>Supplier name</label>
        <input className="input" id={`name-${email ?? "new"}`} name="name" defaultValue={name} placeholder="Austin Woodworks" required />
      </div>
      <div className="field">
        <label className="label" htmlFor={`email-${email ?? "new"}`}>Orders go to</label>
        <input className="input" id={`email-${email ?? "new"}`} name="email" type="email" defaultValue={email} placeholder="orders@supplier.com" required />
      </div>
    </div>
  );
}

export function AddSupplierForm() {
  const [state, action] = useActionState(addOwnSupplierAction, {} as FormState);
  const freshKey = useFreshKey(state, "add");
  return (
    // A fresh form after each add, so the fields clear.
    <form key={freshKey} action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Supplier added. Pick them on a product's page under "Who sends it".</p>}
      <Fields />
      <SubmitButton className="btn btn-primary self-start">Add supplier</SubmitButton>
    </form>
  );
}

type Supplier = { id: string; name: string; email: string; link: string; products: number; openOrders: number };

export function OwnSupplierCard({ supplier }: { supplier: Supplier }) {
  const [editState, edit] = useActionState(updateOwnSupplierAction.bind(null, supplier.id), {} as FormState);
  const [resetState, reset] = useActionState(resetSupplierLinkAction.bind(null, supplier.id), {} as FormState);
  const [removeState, remove] = useActionState(removeOwnSupplierAction.bind(null, supplier.id), {} as FormState);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const error = editState.error ?? resetState.error ?? removeState.error;
  return (
    <li className="card p-5 flex flex-col gap-3" aria-label={supplier.name}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="font-semibold">{supplier.name}</h3>
          <p className="text-sm hint">{supplier.email}</p>
        </div>
        <p className="text-sm hint">
          {supplier.products} product{supplier.products === 1 ? "" : "s"} · {supplier.openOrders} order{supplier.openOrders === 1 ? "" : "s"} to send
        </p>
      </div>
      <FormError message={error} />
      {resetState.saved && <p className="banner banner-info" role="status">New link made. The old one no longer works; send them this one.</p>}
      <div className="flex flex-col gap-1">
        <span className="label">Their tracking page</span>
        <div className="flex flex-wrap gap-2 items-center">
          <input className="input flex-1 min-w-56 text-sm" readOnly value={supplier.link} aria-label={`Tracking page link for ${supplier.name}`} />
          <button type="button" className="btn btn-secondary" onClick={() => void navigator.clipboard.writeText(supplier.link).then(() => setCopied(true))}>{copied ? "Copied" : "Copy"}</button>
        </div>
        <p className="hint">It's in every order email too. Anyone with it can see this supplier's orders and shipping addresses, so only share it with them.</p>
      </div>
      {editing ? (
        <form action={edit} className="flex flex-col gap-3">
          {editState.saved && <p className="banner banner-success" role="status">Saved.</p>}
          <Fields name={supplier.name} email={supplier.email} />
          <div className="flex gap-2">
            <SubmitButton className="btn btn-primary">Save</SubmitButton>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>Edit</button>
          <form action={reset}><SubmitButton className="btn btn-secondary">New link</SubmitButton></form>
          <form action={remove}><SubmitButton className="btn btn-secondary text-critical">Remove</SubmitButton></form>
        </div>
      )}
    </li>
  );
}
