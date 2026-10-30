"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import type { FormState } from "../../actions";
import { productQuizAction } from "../../quiz-actions";

type Question = { text: string; answers: { label: string; tag: string }[] };
type Props = { quiz: { title: string; intro: string | null; on: boolean; questions: Question[] } | null; tags: string[]; maxQuestions: number; maxAnswers: number };

const blank = (): Question => ({ text: "", answers: [{ label: "", tag: "" }, { label: "", tag: "" }, { label: "", tag: "" }] });

/** The quiz's questions, each answer with the product tag it leads to. Submitted by hand so nothing typed is lost when it's refused. */
export function QuizForm({ quiz, tags, maxQuestions, maxAnswers }: Props) {
  const [state, action] = useActionState(productQuizAction, {} as FormState);
  const [questions, setQuestions] = useState<Question[]>(quiz?.questions.length ? quiz.questions : [blank()]);
  const addAnswer = (i: number) => setQuestions((qs) => qs.map((q, k) => (k === i ? { ...q, answers: [...q.answers, { label: "", tag: "" }] } : q)));
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        data.set("step", ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? "save");
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Saved.</p>}
      <div className="field">
        <label className="label" htmlFor="quiz-title">Quiz title</label>
        <input className="input" id="quiz-title" name="title" maxLength={60} placeholder="Find your lamp" defaultValue={quiz?.title} required />
      </div>
      <div className="field">
        <label className="label" htmlFor="quiz-intro">A line under the title (optional)</label>
        <input className="input" id="quiz-intro" name="intro" maxLength={200} placeholder="Three questions and we'll pick for you." defaultValue={quiz?.intro ?? ""} />
      </div>
      <datalist id="quiz-tags">
        {tags.map((t) => <option key={t} value={t} />)}
      </datalist>
      {questions.map((q, i) => (
        <fieldset key={i} className="border border-border rounded-md p-4 flex flex-col gap-3">
          <legend className="label px-1">Question {i + 1}</legend>
          <input className="input" name={`q${i}`} aria-label={`Question ${i + 1}`} maxLength={120} placeholder={i === 0 ? "Who's it for?" : "Another question"} defaultValue={q.text} />
          {q.answers.map((a, j) => (
            <div key={j} className="grid grid-cols-[1fr_10rem] gap-2">
              <input className="input" name={`q${i}a${j}`} aria-label={`Question ${i + 1}, answer ${j + 1}`} maxLength={60} placeholder={j === 0 ? "My kids" : "An answer"} defaultValue={a.label} />
              <input className="input" name={`q${i}t${j}`} aria-label={`Question ${i + 1}, answer ${j + 1}, product tag`} list="quiz-tags" maxLength={30} placeholder="tag" defaultValue={a.tag} />
            </div>
          ))}
          {q.answers.length < maxAnswers && (
            <button type="button" className="hint text-sm self-start underline" onClick={() => addAnswer(i)}>
              Add an answer
            </button>
          )}
        </fieldset>
      ))}
      {questions.length < maxQuestions && (
        <button type="button" className="btn btn-secondary btn-sm self-start" onClick={() => setQuestions((qs) => [...qs, blank()])}>
          Add a question
        </button>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="on" defaultChecked={quiz?.on ?? true} /> Show the quiz on the store
      </label>
      <div className="flex flex-wrap gap-3 items-center">
        <button className="btn btn-primary" value="save">Save the quiz</button>
        {quiz && (
          <button className="hint hover:text-critical text-sm" value="remove" formNoValidate>
            Remove the quiz
          </button>
        )}
      </div>
    </form>
  );
}
