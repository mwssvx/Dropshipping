"use client";
import { startTransition, useActionState } from "react";
import type { BuyerSurvey } from "@sf/db";
import { FormError } from "@/components/FormError";
import { surveyAction, type SurveyState } from "../../survey-actions";

const STARTER = ["Instagram", "TikTok", "Facebook", "Google search", "A friend or family member", "YouTube", "A podcast"];

/** The question, one answer per line, and whether buyers can type their own. */
export function SurveyForm({ survey }: { survey: BuyerSurvey | null }) {
  const [state, action, pending] = useActionState(surveyAction, {} as SurveyState);
  return (
    // Submitted by hand so React doesn't reset the fields after an error.
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        if (submitter?.name) data.set(submitter.name, submitter.value);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved && !pending && !state.error && (
        <p className="banner banner-success" role="status">{state.saved === "on" ? "Saved. Buyers see it on their order page after paying." : "Turned off. Buyers aren't asked any more."}</p>
      )}
      <div className="field">
        <label className="label" htmlFor="survey-question">Question</label>
        <input className="input" id="survey-question" name="question" maxLength={120} defaultValue={survey?.question ?? "How did you hear about us?"} />
      </div>
      <div className="field">
        <label className="label" htmlFor="survey-options">Answers to pick from, one per line</label>
        <textarea className="input" id="survey-options" name="options" rows={6} defaultValue={(survey?.options ?? STARTER).join("\n")} />
        <p className="hint text-sm">2 to 8 answers, each under 40 characters.</p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="other" defaultChecked={survey?.other ?? true} />
        Add &quot;Other&quot; with a box to type in
      </label>
      <div className="flex gap-2">
        <button type="submit" name="intent" value="on" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : survey ? "Save survey" : "Start asking"}</button>
        {survey && <button type="submit" name="intent" value="off" className="btn btn-secondary" disabled={pending}>Turn off</button>}
      </div>
    </form>
  );
}
