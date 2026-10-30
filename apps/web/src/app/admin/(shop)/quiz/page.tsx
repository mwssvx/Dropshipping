import Link from "next/link";
import { productTags, QUIZ_MAX_ANSWERS, QUIZ_MAX_QUESTIONS } from "@sf/core";
import { requireShop, storeAddress } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { QuizForm } from "./QuizForm";

export const metadata = { title: "Product quiz" };

export default async function QuizPage() {
  const { shop, db } = await requireShop("marketing");
  const [tags, store] = await Promise.all([productTags(db, shop.id), storeAddress(shop)]);
  const quiz = shop.productQuiz;
  return (
    <main className="pb-12">
      <PageHeader title="Product quiz" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <p className="hint max-w-2xl">
          A few questions that point shoppers to the right products, for stores with more to choose from than people like to scroll through.
          Each answer leads to one of your product tags. The picks are the products with the most of the tags a shopper chose, best sellers
          first, and never anything sold out.
        </p>
        {tags.length < 2 ? (
          <p className="banner banner-warning">
            Answers lead to product tags, and your products have {tags.length ? "only one" : "none"} yet. <Link href="/admin/products" className="underline">Tag your products</Link> first (like &quot;kids&quot; or &quot;bedroom&quot;).
          </p>
        ) : (
          <section className="card p-5 flex flex-col gap-4" aria-label="Quiz">
            {quiz?.on && (
              <div className="field">
                <label className="label" htmlFor="quiz-link">Link to share</label>
                <input className="input font-mono text-xs" id="quiz-link" readOnly value={`${store}/quiz`} />
                <span className="hint">Add it to your store&apos;s menu, your bio or a campaign.</span>
              </div>
            )}
            <QuizForm quiz={quiz} tags={tags.map((t) => t.tag)} maxQuestions={QUIZ_MAX_QUESTIONS} maxAnswers={QUIZ_MAX_ANSWERS} />
          </section>
        )}
      </div>
    </main>
  );
}
