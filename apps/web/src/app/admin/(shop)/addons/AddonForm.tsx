"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { createAddonAction, type AddonState } from "../../addon-actions";

export function AddonForm({ products }: { products: { id: string; title: string }[] }) {
  const [state, action] = useActionState(createAddonAction, {} as AddonState);
  return (
    <form action={action} key={state.key} className="flex flex-col gap-4">
      <FormError message={state.error} />
      {state.message && <p role="status" className="banner banner-success">{state.message}</p>}
      <div className="grid sm:grid-cols-[1fr_10rem] gap-3">
        <div className="field">
          <label className="label" htmlFor="productId">Product</label>
          <select className="input" id="productId" name="productId" required defaultValue="">
            <option value="" disabled>Pick a product</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="percentOff">Discount (%)</label>
          <input className="input num" id="percentOff" name="percentOff" type="number" min={0} max={50} required defaultValue={15} />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="pitch">One line for buyers (optional)</label>
        <input className="input" id="pitch" name="pitch" maxLength={120} placeholder="Keeps your phone up while it charges" />
      </div>
      <SubmitButton className="btn btn-primary self-start" pendingText="Saving…">Add add-on</SubmitButton>
    </form>
  );
}
