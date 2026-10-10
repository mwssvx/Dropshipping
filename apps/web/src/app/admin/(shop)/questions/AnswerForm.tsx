"use client";
import { useActionState, useEffect, useState } from "react";
import { FormError } from "@/components/FormError";
import { answerQuestionAction, draftAnswerAction, type AnswerState } from "../../question-actions";

/** The answer box: write it, or start from the AI's draft, then send it to the shopper. */
export function AnswerForm({ id, answer, draft, published, answered }: { id: string; answer: string | null; draft: string | null; published: boolean; answered: boolean }) {
  const [sent, send, sending] = useActionState(answerQuestionAction.bind(null, id), {} as AnswerState);
  const [drafted, ask, drafting] = useActionState(draftAnswerAction.bind(null, id), {} as AnswerState);
  const [text, setText] = useState(answer ?? draft ?? "");
  // Whichever button was pressed last says how it went. A new draft replaces what's in the box.
  const [state, setState] = useState<AnswerState>({});
  useEffect(() => setState(sent), [sent]);
  useEffect(() => {
    setState(drafted);
    if (drafted.answer) setText(drafted.answer);
  }, [drafted]);
  return (
    <div className="flex flex-col gap-2">
      <form action={send} className="flex flex-col gap-2">
        <label className="label" htmlFor={`answer-${id}`}>{answered ? "Your answer" : "Answer"}</label>
        <textarea className="input" id={`answer-${id}`} name="answer" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
        {text.startsWith("[Check:") && <p className="hint text-sm">The AI marked something to check. Fill it in and take out the part in brackets before you send.</p>}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="publish" defaultChecked={published || !answered} />
          Show it on the product page too
        </label>
        <FormError message={state.error} />
        {state.message && !state.error && <p role="status" className="text-sm text-success">{state.message}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={sending}>{sending ? "Sending…" : answered ? "Save answer" : "Send answer"}</button>
          {!answered && (
            <button type="submit" formAction={ask} className="btn btn-secondary" disabled={drafting}>{drafting ? "Drafting…" : "Draft with AI"}</button>
          )}
        </div>
      </form>
    </div>
  );
}
