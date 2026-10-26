"use client";
import Link from "next/link";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { reviewsImportAction, type ReviewsImportState } from "../../../shopify-import-actions";

const reviews = (n: number) => (n === 1 ? "1 review" : `${n.toLocaleString("en-US")} reviews`);

export function ReviewsImportForm() {
  const [state, action, pending] = useActionState(reviewsImportAction, {} as ReviewsImportState);
  const r = !pending ? state.result : undefined;
  return (
    <form action={action} className="card p-5 flex flex-col gap-4">
      <FormError message={state.error} />
      {r && (
        <div className="banner banner-success flex flex-col gap-1" role="status">
          <p>
            {reviews(r.added)} added from {r.format}
            {r.alreadyHere ? `, ${reviews(r.alreadyHere)} ${r.alreadyHere === 1 ? "was" : "were"} already here` : ""}.
            {r.missingCount ? ` ${reviews(r.missingCount)} ${r.missingCount === 1 ? "is" : "are"} for products that aren't in your store yet (${r.missingProducts.join(", ")}). Bring those products over, then add the file again.` : ""}
            {r.unusable ? ` ${r.unusable === 1 ? "1 row was" : `${r.unusable} rows were`} spam or had no stars or words, and ${r.unusable === 1 ? "was" : "were"} left out.` : ""}
          </p>
          <Link href="/admin/reviews?show=published" className="underline">See your reviews</Link>
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="reviews-file">Reviews file (CSV)</label>
        <input className="input" id="reviews-file" name="file" type="file" accept=".csv,text/csv" required />
      </div>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Adding reviews…" : "Add reviews"}</button>
      </div>
    </form>
  );
}
