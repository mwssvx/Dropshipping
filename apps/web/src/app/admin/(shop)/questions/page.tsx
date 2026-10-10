import { listQuestions } from "@sf/core";
import { requireShop, storeAddress } from "@/lib/server";
import { deleteQuestionAction, publishQuestionAction } from "../../question-actions";
import { PageHeader } from "../PageHeader";
import { AnswerForm } from "./AnswerForm";

export const metadata = { title: "Questions" };

const when = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default async function QuestionsPage() {
  const { shop, db } = await requireShop("reviews");
  const [rows, address] = await Promise.all([listQuestions(db, shop.id), storeAddress(shop)]);
  const waiting = rows.filter((r) => r.status === "waiting");
  const answered = rows.filter((r) => r.status !== "waiting");
  return (
    <main className="pb-12">
      <PageHeader title="Questions" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <p className="hint">
          Shoppers ask about a product on its page. Answer here and they get your answer by email. Answers you show on the product page help the next
          shopper too. “Draft with AI” suggests an answer from the listing and your store&apos;s policies, for you to check.
        </p>
        <section className="flex flex-col gap-3" aria-labelledby="waiting-heading">
          <h2 id="waiting-heading" className="font-semibold">Waiting for an answer{waiting.length ? ` (${waiting.length})` : ""}</h2>
          {waiting.length === 0 ? (
            <p className="hint">Nothing waiting. New questions show up here.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {waiting.map((q) => (
                <li key={q.id} className="card p-4 flex flex-col gap-3" aria-label={`Question from ${q.name}`}>
                  <div className="text-sm">
                    <span className="font-medium">{q.name}</span>
                    <span className="hint"> on <a className="underline" href={`${address}/products/${q.product.handle}`} target="_blank">{q.product.title}</a> · {when(q.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-line">{q.body}</p>
                  <AnswerForm id={q.id} answer={null} draft={q.draft} published={false} answered={false} />
                  <form action={deleteQuestionAction.bind(null, q.id)}>
                    <button className="hint text-sm hover:text-critical">Delete without answering</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
        {answered.length > 0 && (
          <section className="flex flex-col gap-3" aria-labelledby="answered-heading">
            <h2 id="answered-heading" className="font-semibold">Answered</h2>
            <ul className="flex flex-col gap-3">
              {answered.map((q) => (
                <li key={q.id} className="card p-4 flex flex-col gap-2" aria-label={`Question from ${q.name}`}>
                  <div className="text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{q.name}</span>
                    <span className="hint">on {q.product.title} · {when(q.createdAt)}</span>
                    <span className={`pill ${q.status === "published" ? "pill-success" : "pill-neutral"}`}>{q.status === "published" ? "On the product page" : "Emailed only"}</span>
                  </div>
                  <p className="whitespace-pre-line">{q.body}</p>
                  <p className="text-sm border-l-2 border-border pl-3 whitespace-pre-line">{q.answer}</p>
                  <details className="text-sm">
                    <summary className="hint cursor-pointer">Change the answer</summary>
                    <div className="pt-2">
                      <AnswerForm id={q.id} answer={q.answer} draft={null} published={q.status === "published"} answered />
                    </div>
                  </details>
                  <div className="flex flex-wrap gap-2">
                    <form action={publishQuestionAction.bind(null, q.id, q.status !== "published")}>
                      <button className="btn btn-secondary">{q.status === "published" ? "Take off the page" : "Show on the page"}</button>
                    </form>
                    <form action={deleteQuestionAction.bind(null, q.id)}>
                      <button className="btn btn-secondary">Delete</button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
