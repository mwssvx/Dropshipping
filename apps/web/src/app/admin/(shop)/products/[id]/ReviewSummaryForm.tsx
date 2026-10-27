"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { saveReviewSummaryAction, summarizeReviewsAction } from "../../../ai-actions";

/** "What buyers say" above the product's reviews: written by AI from the reviews, editable here. */
export function ReviewSummaryForm({ productId, summary, from, published, min, max }: { productId: string; summary: string; from: number | null; published: number; min: number; max: number }) {
  const [saved, save] = useActionState(saveReviewSummaryAction.bind(null, productId), {});
  const [written, write] = useActionState(summarizeReviewsAction.bind(null, productId), {});
  const enough = published >= min;
  return (
    <div className="flex flex-col gap-3">
      <form action={write} className="flex items-center justify-between gap-3 flex-wrap">
        <p className="hint text-sm">
          {enough ? `${published} published review${published === 1 ? "" : "s"}.` : `Needs at least ${min} published reviews; this product has ${published}.`}
          {summary && from !== null && from !== published && ` The summary was written from ${from}.`}
        </p>
        <SubmitButton className="btn btn-secondary" pendingText="Summarizing…" disabled={!enough}>{summary ? "Summarize again with AI" : "Summarize with AI"}</SubmitButton>
      </form>
      <FormError message={written.error} />
      {written.message && <p className="banner banner-info" role="status">{written.message}</p>}
      <form action={save} className="flex flex-col gap-3">
        <FormError message={saved.error} />
        {saved.message && !saved.error && <p className="banner banner-success" role="status">{saved.message}</p>}
        <div className="field">
          <label className="label" htmlFor="review-summary">Summary</label>
          {/* Keyed so a new AI summary replaces what's in the box. */}
          <textarea key={summary} className="input text-sm" id="review-summary" name="summary" rows={3} maxLength={max} defaultValue={summary} placeholder="Empty: no summary on the product page." />
        </div>
        <div><SubmitButton className="btn btn-secondary">Save summary</SubmitButton></div>
      </form>
    </div>
  );
}
