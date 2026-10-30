// Product quiz: a few questions ("Who's it for?", "What's the room like?") that point a shopper to
// the right products, the way quiz apps do on Shopify for a monthly fee. Each answer stands for a
// product tag the store already uses; the picks are the products with the most of the chosen
// tags, best sellers first, and nothing sold out. One quiz per store, at <store>/quiz.
import { eq } from "drizzle-orm";
import { schema, type Db, type ProductQuiz } from "@sf/db";
import { productSoldOut } from "./badges";
import { normalizeTags } from "./customers";
import { UserError } from "./errors";
import { listActiveProducts, productTags } from "./products";
import { unitsSold } from "./search";

export const QUIZ_MAX_QUESTIONS = 5;
export const QUIZ_MAX_ANSWERS = 5;
export const QUIZ_PICKS = 6;

type QuizInput = { title: string; intro?: string | null; on: boolean; questions: { text: string; answers: { label: string; tag: string }[] }[] };

/** Saves the quiz, or removes it with null. Questions and answers left empty are dropped. */
export async function setProductQuiz(db: Db, shopId: string, input: QuizInput | null) {
  let value: ProductQuiz | null = null;
  if (input) {
    const title = input.title.trim();
    if (!title) throw new UserError("Give the quiz a title, like Find your lamp.");
    if (title.length > 60) throw new UserError("Keep the title under 60 characters.");
    const intro = input.intro?.trim() || null;
    if (intro && intro.length > 200) throw new UserError("Keep the intro under 200 characters.");
    const tags = new Set((await productTags(db, shopId)).map((t) => t.tag));
    const questions = [];
    for (const q of input.questions) {
      const text = q.text.trim();
      const answers = q.answers.map((a) => ({ label: a.label.trim(), tag: a.tag.trim() })).filter((a) => a.label || a.tag);
      if (!text && !answers.length) continue;
      if (!text) throw new UserError("Each question needs its words.");
      if (text.length > 120) throw new UserError(`Keep "${text.slice(0, 30)}…" under 120 characters.`);
      if (answers.length < 2) throw new UserError(`"${text}" needs at least two answers.`);
      if (answers.length > QUIZ_MAX_ANSWERS) throw new UserError(`A question has up to ${QUIZ_MAX_ANSWERS} answers.`);
      const clean = [];
      for (const a of answers) {
        if (!a.label) throw new UserError(`An answer to "${text}" needs its words.`);
        if (a.label.length > 60) throw new UserError(`Keep the answer "${a.label.slice(0, 30)}…" under 60 characters.`);
        const [tag] = normalizeTags(a.tag, "An answer", 1);
        if (!tag) throw new UserError(`Pick the product tag "${a.label}" leads to.`);
        if (!tags.has(tag)) throw new UserError(`No product is tagged "${tag}" yet. Tag some products first, or pick a tag you use.`);
        clean.push({ label: a.label, tag });
      }
      questions.push({ text, answers: clean });
    }
    if (!questions.length) throw new UserError("Add at least one question with two answers.");
    if (questions.length > QUIZ_MAX_QUESTIONS) throw new UserError(`A quiz has up to ${QUIZ_MAX_QUESTIONS} questions.`);
    value = { title, intro, on: input.on, questions };
  }
  await db.update(schema.shops).set({ productQuiz: value, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return value;
}

/**
 * The products for a shopper's answers (an answer index per question; a skipped one is null):
 * those with the most of the chosen tags, then best sellers, never sold out. Each says how many
 * answers it matches.
 */
export async function quizPicks(db: Db, shop: { id: string; productQuiz: ProductQuiz | null }, picked: (number | null)[], limit = QUIZ_PICKS) {
  const quiz = shop.productQuiz;
  if (!quiz) return { products: [], matched: new Map<string, number>(), answered: 0 };
  const chosen = quiz.questions.flatMap((q, i) => {
    const a = picked[i];
    return a != null && q.answers[a] ? [q.answers[a].tag] : [];
  });
  if (!chosen.length) return { products: [], matched: new Map<string, number>(), answered: 0 };
  const products = (await listActiveProducts(db, shop.id)).filter((p) => !p.giftCard && !productSoldOut(p));
  const scored = products.map((p) => ({ p, score: chosen.filter((t) => p.tags.includes(t)).length })).filter((r) => r.score > 0);
  const sold = await unitsSold(db, shop.id, scored.map((r) => r.p.id));
  scored.sort((a, b) => b.score - a.score || (sold.get(b.p.id) ?? 0) - (sold.get(a.p.id) ?? 0) || b.p.createdAt.getTime() - a.p.createdAt.getTime());
  const top = scored.slice(0, limit);
  return { products: top.map((r) => r.p), matched: new Map(top.map((r) => [r.p.id, r.score])), answered: chosen.length };
}

/** "0,2,,1" from the address: an answer index per question, null where skipped or out of range. */
export function parseQuizAnswers(quiz: ProductQuiz, raw: string | null | undefined) {
  const parts = (raw ?? "").split(",");
  return quiz.questions.map((q, i) => {
    const n = Number(parts[i]);
    return parts[i] !== undefined && parts[i] !== "" && Number.isInteger(n) && n >= 0 && n < q.answers.length ? n : null;
  });
}
