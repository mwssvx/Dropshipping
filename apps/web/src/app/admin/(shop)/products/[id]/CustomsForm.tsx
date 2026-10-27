"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { customsAction, type CustomsState } from "../../../customs-actions";

/** The HS code and country of origin printed on customs forms. */
export function CustomsForm({ productId, hsCode, originCountry }: { productId: string; hsCode: string | null; originCountry: string | null }) {
  const [state, action, pending] = useActionState(customsAction.bind(null, productId), {} as CustomsState);
  return (
    // Submitted by hand so React doesn't reset the fields after an error.
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved && !pending && !state.error && (
        <p className="banner banner-success" role="status">Saved. Customs forms for this product now use it.</p>
      )}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="field w-48">
          <label className="label" htmlFor="customs-hs">HS code</label>
          <input className="input num" id="customs-hs" name="hsCode" inputMode="numeric" maxLength={14} placeholder="6912.00" defaultValue={hsCode ?? ""} />
        </div>
        <div className="field w-48">
          <label className="label" htmlFor="customs-origin">Made in (country code)</label>
          <input className="input uppercase" id="customs-origin" name="originCountry" maxLength={2} placeholder="CN" defaultValue={originCountry ?? ""} />
        </div>
      </div>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save customs info"}</button>
      </div>
    </form>
  );
}
