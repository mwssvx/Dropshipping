// Product questions: a shopper asks on the product page ("Does it come with a UK plug?"), the
// merchant answers in the admin (the AI can draft the answer from the listing and the store's
// policies), and the shopper gets the answer by email. Answers the merchant shows on the page help
// the next shopper too; a private answer only goes by email.
import { and, asc, count, desc, eq, gte, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import type { Mailer } from "./email";

/** Questions one email can have waiting in a store in a day, to keep spam out. */
export const MAX_QUESTIONS_PER_DAY = 5;

type Shop = typeof schema.shops.$inferSelect;
export type ProductQuestion = typeof schema.productQuestions.$inferSelect;

export type QuestionContext = {
  db: Db;
  mailer: Mailer;
  /** The store's public address, like https://lumen.example.com, with no trailing slash. */
  storeAddress: (shop: Shop) => string | Promise<string>;
  now?: () => Date;
};

const questionInput = z.object({
  productId: z.string().uuid("That product isn't available."),
  name: z.string().trim().min(1, "Add your name.").max(60, "Keep the name under 60 characters."),
  email: z.string().trim().toLowerCase().email("Enter your email so we can send you the answer."),
  body: z.string().trim().min(10, "Write a little more, at least 10 characters.").max(500, "Keep the question under 500 characters."),
});
export type QuestionInput = z.input<typeof questionInput>;

/** A shopper asks about a product on sale. */
export async function askQuestion(db: Db, shopId: string, input: QuestionInput, now = new Date()) {
  const parsed = questionInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message, "invalid");
  const { productId, name, email, body } = parsed.data;
  const product = await db.query.products.findFirst({
    where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId), eq(schema.products.status, "active")),
    columns: { id: true },
  });
  if (!product) throw new UserError("That product isn't available.", "invalid");
  const [{ n }] = (await db
    .select({ n: count() })
    .from(schema.productQuestions)
    .where(and(eq(schema.productQuestions.shopId, shopId), eq(schema.productQuestions.email, email), gte(schema.productQuestions.createdAt, new Date(now.getTime() - 86_400_000))))) as [{ n: number }];
  if (n >= MAX_QUESTIONS_PER_DAY) throw new UserError("You've asked a lot of questions today. We'll answer those first.", "too_many");
  const [row] = await db.insert(schema.productQuestions).values({ shopId, productId, name, email, body, createdAt: now }).returning();
  return row!;
}

/** Every question for the admin: waiting ones first (oldest first), then answered ones, newest first. */
export async function listQuestions(db: Db, shopId: string) {
  const rows = await db
    .select({ question: schema.productQuestions, product: { title: schema.products.title, handle: schema.products.handle } })
    .from(schema.productQuestions)
    .innerJoin(schema.products, eq(schema.products.id, schema.productQuestions.productId))
    .where(eq(schema.productQuestions.shopId, shopId))
    .orderBy(sql`${schema.productQuestions.status} = 'waiting' desc`, sql`case when ${schema.productQuestions.status} = 'waiting' then ${schema.productQuestions.createdAt} end asc`, desc(schema.productQuestions.answeredAt))
    .limit(300);
  return rows.map((r) => ({ ...r.question, product: r.product }));
}

export async function waitingQuestions(db: Db, shopId: string) {
  const [{ n }] = (await db
    .select({ n: count() })
    .from(schema.productQuestions)
    .where(and(eq(schema.productQuestions.shopId, shopId), eq(schema.productQuestions.status, "waiting")))) as [{ n: number }];
  return Number(n);
}

async function findQuestion(db: Db, shopId: string, questionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(questionId)) throw new NotFoundError("Question");
  const q = await db.query.productQuestions.findFirst({ where: and(eq(schema.productQuestions.id, questionId), eq(schema.productQuestions.shopId, shopId)) });
  if (!q) throw new NotFoundError("Question");
  return q;
}

/** The AI's suggested answer, kept until the merchant answers. Answered questions keep their answer. */
export async function saveQuestionDraft(db: Db, shopId: string, questionId: string, draft: string) {
  const q = await findQuestion(db, shopId, questionId);
  if (q.status !== "waiting") throw new UserError("That question has been answered already.");
  const text = draft.trim().slice(0, 1000);
  if (!text) throw new UserError("The draft is empty.");
  await db.update(schema.productQuestions).set({ draft: text }).where(eq(schema.productQuestions.id, q.id));
  return text;
}

const answerInput = z.object({
  answer: z.string().trim().min(2, "Write the answer first.").max(1000, "Keep the answer under 1,000 characters."),
  publish: z.boolean(),
});

/**
 * Answers (or changes the answer to) a question. The shopper is emailed the first answer once;
 * changing it later, or moving it on or off the product page, doesn't email them again.
 */
export async function answerQuestion(ctx: QuestionContext, shop: Shop, questionId: string, input: z.input<typeof answerInput>) {
  const parsed = answerInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { db } = ctx;
  const now = ctx.now?.() ?? new Date();
  const q = await findQuestion(db, shop.id, questionId);
  const [row] = await db
    .update(schema.productQuestions)
    .set({ answer: parsed.data.answer, status: parsed.data.publish ? "published" : "private", draft: null, answeredAt: q.answeredAt ?? now })
    .where(eq(schema.productQuestions.id, q.id))
    .returning();
  // Claim the email first, so pressing twice doesn't send two.
  const [claimed] = await db
    .update(schema.productQuestions)
    .set({ notifiedAt: now })
    .where(and(eq(schema.productQuestions.id, q.id), sql`${schema.productQuestions.notifiedAt} is null`))
    .returning({ id: schema.productQuestions.id });
  let emailed = false;
  if (claimed) {
    const product = (await db.query.products.findFirst({ where: eq(schema.products.id, q.productId), columns: { title: true, handle: true } }))!;
    const link = `${await ctx.storeAddress(shop)}/products/${product.handle}${parsed.data.publish ? "#questions" : ""}`;
    try {
      await ctx.mailer.send({
        to: q.email,
        subject: `Your question about ${product.title}`,
        text: [
          `Hi ${q.name},`,
          ``,
          `You asked ${shop.name} about ${product.title}:`,
          `“${q.body}”`,
          ``,
          parsed.data.answer,
          ``,
          `See the product: ${link}`,
          ``,
          `${shop.name}`,
        ].join("\n"),
      });
      emailed = true;
    } catch {
      // Let the next answer try again.
      await db.update(schema.productQuestions).set({ notifiedAt: null }).where(eq(schema.productQuestions.id, q.id));
    }
  }
  return { question: row!, emailed };
}

/** Takes an answered question off the product page, or puts it back. */
export async function setQuestionPublished(db: Db, shopId: string, questionId: string, publish: boolean) {
  const q = await findQuestion(db, shopId, questionId);
  if (q.status === "waiting") throw new UserError("Answer the question first.");
  await db.update(schema.productQuestions).set({ status: publish ? "published" : "private" }).where(eq(schema.productQuestions.id, q.id));
}

export async function deleteQuestion(db: Db, shopId: string, questionId: string) {
  const [row] = await db
    .delete(schema.productQuestions)
    .where(and(eq(schema.productQuestions.id, questionId), eq(schema.productQuestions.shopId, shopId)))
    .returning({ id: schema.productQuestions.id });
  if (!row) throw new NotFoundError("Question");
}

/** Answered questions shown on a product page, newest answer first. Shoppers' emails never leave the admin. */
export async function productQuestions(db: Db, productId: string, limit = 20) {
  return db
    .select({ id: schema.productQuestions.id, name: schema.productQuestions.name, body: schema.productQuestions.body, answer: schema.productQuestions.answer, answeredAt: schema.productQuestions.answeredAt })
    .from(schema.productQuestions)
    .where(and(eq(schema.productQuestions.productId, productId), eq(schema.productQuestions.status, "published")))
    .orderBy(desc(schema.productQuestions.answeredAt), asc(schema.productQuestions.id))
    .limit(limit);
}
