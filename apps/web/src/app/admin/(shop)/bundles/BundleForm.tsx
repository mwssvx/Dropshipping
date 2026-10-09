"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { createBundleAction, type BundleState } from "../../bundle-actions";

export function BundleForm({ products }: { products: { id: string; title: string }[] }) {
  const [state, action] = useActionState(createBundleAction, {} as BundleState);
  return (
    <form action={action} key={state.key} className="flex flex-col gap-4">
      <FormError message={state.error} />
      {state.message && <p role="status" className="banner banner-success">{state.message}</p>}
      <div className="field">
        <label className="label" htmlFor="title">Name</label>
        <input className="input" id="title" name="title" maxLength={80} required placeholder="Desk set" />
        <span className="hint">Buyers see it on the product page and in their cart.</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="field">
            <label className="label" htmlFor={`product${n}`}>Product {n}{n > 2 ? " (optional)" : ""}</label>
            <select className="input" id={`product${n}`} name={`product${n}`} required={n <= 2} defaultValue="">
              <option value="">{n > 2 ? "None" : "Pick a product"}</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
        ))}
      </div>
      <div className="field max-w-40">
        <label className="label" htmlFor="percentOff">Discount (%)</label>
        <input className="input num" id="percentOff" name="percentOff" type="number" min={1} max={50} required defaultValue={10} />
      </div>
      <SubmitButton className="btn btn-primary self-start" pendingText="Adding…">Add bundle</SubmitButton>
    </form>
  );
}
