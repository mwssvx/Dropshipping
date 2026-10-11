"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { productBadgeAction, type BadgeState } from "../../../badge-actions";

/** The merchant's own label on this product's card. */
export function BadgeForm({ productId, badge, max }: { productId: string; badge: string; max: number }) {
  const [state, action, pending] = useActionState(productBadgeAction.bind(null, productId), {} as BadgeState);
  return (
    // Submitted by hand so React doesn't reset the field after an error.
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved !== undefined && !pending && !state.error && (
        <p className="banner banner-success" role="status">{state.saved ? "Saved. The badge shows on this product's card and page." : "Saved. This product has no badge of its own."}</p>
      )}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="field w-64">
          <label className="label" htmlFor="product-badge">Badge text</label>
          <input className="input" id="product-badge" name="badge" maxLength={max} autoComplete="off" placeholder="Bestseller" defaultValue={badge} />
        </div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save badge"}</button>
      </div>
    </form>
  );
}
