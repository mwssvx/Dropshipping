"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { answerSurveyAction } from "../../actions";

/** The store's one question after paying, such as "How did you hear about us?". */
export function SurveyQuestion({ handle, orderRef, question, options, other }: { handle: string; orderRef: string; question: string; options: string[]; other: boolean }) {
  const [state, action, pending] = useActionState(answerSurveyAction.bind(null, handle, orderRef), {});
  const [picked, setPicked] = useState("");
  return (
    <section className="card p-5 flex flex-col gap-3" aria-labelledby="survey-heading">
      <h2 id="survey-heading" className="font-semibold text-lg">{question}</h2>
      {/* Submitted by hand so React doesn't reset the choice when there's an error. */}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(() => action(data));
        }}
      >
        <FormError message={state.error} />
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{question}</legend>
          {[...options, ...(other ? ["Other"] : [])].map((o) => (
            <label key={o} className="flex items-center gap-2 text-sm">
              <input type="radio" name="answer" value={o} checked={picked === o} onChange={() => setPicked(o)} required />
              {o}
            </label>
          ))}
        </fieldset>
        {picked === "Other" && (
          <div className="field max-w-sm">
            <label className="label" htmlFor="survey-other">Tell us where</label>
            <input className="input" id="survey-other" name="other" maxLength={100} />
          </div>
        )}
        <button type="submit" className="btn btn-secondary self-start" disabled={pending || !picked} aria-busy={pending}>{pending ? "Sending…" : "Send answer"}</button>
      </form>
    </section>
  );
}
