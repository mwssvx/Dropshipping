import Link from "next/link";
import { notFound } from "next/navigation";
import { compactProducts, parseQuizAnswers, QUIZ_MAX_QUESTIONS, quizPicks } from "@sf/core";
import { db } from "@/lib/server";
import { buyerFx } from "@/lib/currency";
import { ProductGrid } from "@/theme/Sections";
import { loadShop, localProducts, storeBase, storeT } from "../data";
import { addToCartAction } from "../actions";

type Answers = Partial<Record<`q${number}`, string>>;

export async function generateMetadata({ params }: { params: Promise<{ shop: string }> }) {
  const shop = await loadShop((await params).shop);
  return { title: shop.productQuiz?.title ?? "Quiz", robots: { index: false } };
}

/**
 * The store's product quiz: one question per group, then the products that fit the answers. It's
 * a plain form that sends the answers in the address, so a result can be shared or bookmarked.
 */
export default async function QuizPage({ params, searchParams }: { params: Promise<{ shop: string }>; searchParams: Promise<Answers> }) {
  const { shop: param } = await params;
  const query = await searchParams;
  const shop = await loadShop(param);
  const quiz = shop.productQuiz;
  if (!quiz?.on) notFound();
  const [base, fx, t] = await Promise.all([storeBase(param), buyerFx(shop), storeT(param)]);
  const raw = Array.from({ length: QUIZ_MAX_QUESTIONS }, (_, i) => query[`q${i}`] ?? "").join(",");
  const answers = parseQuizAnswers(quiz, raw);
  const asked = Object.keys(query).some((k) => /^q\d$/.test(k));
  const picks = asked ? await quizPicks(await db(), shop, answers) : null;
  const compact = picks ? await localProducts(param, compactProducts(picks.products)) : [];
  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-8">
      <div className="flex flex-col gap-2 max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">{quiz.title}</h1>
        {quiz.intro && <p className="text-muted">{quiz.intro}</p>}
      </div>
      <form action={`${base}/quiz`} method="get" className="flex flex-col gap-6 max-w-2xl">
        {quiz.questions.map((q, i) => (
          <fieldset key={i} className="flex flex-col gap-2">
            <legend className="font-semibold mb-1">{q.text}</legend>
            <div className="flex flex-wrap gap-2">
              {q.answers.map((a, j) => (
                <label key={j} className="btn btn-secondary has-[:checked]:border-accent has-[:checked]:text-accent has-[:focus-visible]:outline-2 cursor-pointer">
                  <input type="radio" className="sr-only" name={`q${i}`} value={j} defaultChecked={answers[i] === j} />
                  {a.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="flex flex-wrap gap-3 items-center">
          <button className="btn btn-primary">{t.quizSubmit}</button>
          {asked && <Link href={`${base}/quiz`} className="underline text-sm">{t.quizAgain}</Link>}
        </div>
      </form>
      {picks && (
        <section className="flex flex-col gap-4" aria-labelledby="quiz-picks">
          <h2 id="quiz-picks" className="text-2xl font-semibold">{t.quizPicks}</h2>
          {compact.length ? (
            <ProductGrid products={compact} data={{ base, currency: shop.currency, fx, t, badges: shop.productBadges, quickAdd: shop.cardQuickAdd ? addToCartAction.bind(null, param) : undefined, catalog: { products: compact, collections: [] } }} />
          ) : (
            <p className="hint">
              {t.quizNone} <Link href={`${base}/collections/all`} className="underline">{t.seeEverything}</Link>
            </p>
          )}
        </section>
      )}
    </main>
  );
}
