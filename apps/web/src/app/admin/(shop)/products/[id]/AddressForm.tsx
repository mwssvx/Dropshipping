"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { productHandleAction } from "../../../redirect-actions";

/** The product's web address (its handle), with the store address in front for context. */
export function AddressForm({ productId, handle, prefix }: { productId: string; handle: string; prefix: string }) {
  const [state, action] = useActionState(productHandleAction.bind(null, productId), {});
  const value = state.handle ?? handle;
  return (
    <form action={action} className="card p-5 flex flex-col gap-3 max-w-3xl" aria-labelledby="address-heading">
      <div>
        <h2 id="address-heading" className="font-semibold">Web address</h2>
        <p className="hint">Change it to something short that buyers and search engines understand. Old links keep working.</p>
      </div>
      <FormError message={state.error} />
      {state.message && <p role="status" className="banner banner-info">{state.message}</p>}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="field flex-1 min-w-56">
          <label className="label" htmlFor="handle">Address</label>
          <div className="flex items-center gap-1">
            <span className="hint whitespace-nowrap truncate max-w-[50%]">{prefix}/products/</span>
            <input className="input" id="handle" name="handle" key={value} defaultValue={value} required maxLength={80} />
          </div>
        </div>
        <SubmitButton className="btn btn-secondary">Save address</SubmitButton>
      </div>
    </form>
  );
}
