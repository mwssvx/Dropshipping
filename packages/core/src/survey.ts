// "How did you hear about us?" Ad dashboards only see clicks, so a podcast mention, a friend or a
// TikTok watched on the bus never shows up. Stores ask buyers once, on the order page right after
// paying, and see which answers bring in the most orders and money. On Shopify this is a paid app.
import { and, desc, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";
import { schema, type BuyerSurvey, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";

type Shop = typeof schema.shops.$inferSelect;

const PAID = ["paid", "partially_refunded", "refunded"] as const;
export const SURVEY_MAX_OPTIONS = 8;
export const SURVEY_OTHER = "Other";
const QUESTION_MAX = 120;
const OPTION_MAX = 40;
const OTHER_MAX = 100;
/** Buyers can answer for this long after the order. */
const ANSWER_DAYS = 30;

/** Sets the store's survey, or turns it off with null. */
export async function setSurvey(db: Db, shopId: string, input: { question: string; options: string[]; other?: boolean } | null) {
  let value: BuyerSurvey | null = null;
  if (input) {
    const question = input.question.trim().replace(/\s+/g, " ");
    if (question.length < 3) throw new UserError("Write the question buyers will answer.");
    if (question.length > QUESTION_MAX) throw new UserError(`Keep the question under ${QUESTION_MAX} characters.`);
    const options: string[] = [];
    for (const raw of input.options) {
      const o = raw.trim().replace(/\s+/g, " ");
      if (!o || options.some((x) => x.toLowerCase() === o.toLowerCase())) continue;
      if (o.length > OPTION_MAX) throw new UserError(`Keep each answer under ${OPTION_MAX} characters: "${o.slice(0, OPTION_MAX)}…" is too long.`);
      // "Other" is the box buyers type in, so it's not a choice of its own.
      if (o.toLowerCase() === SURVEY_OTHER.toLowerCase()) continue;
      options.push(o);
    }
    if (options.length < 2) throw new UserError("Give buyers at least 2 answers to pick from.");
    if (options.length > SURVEY_MAX_OPTIONS) throw new UserError(`Keep it to ${SURVEY_MAX_OPTIONS} answers or fewer.`);
    value = { question, options, other: !!input.other };
  }
  await db.update(schema.shops).set({ survey: value, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return value;
}

type SurveyOrder = Pick<typeof schema.orders.$inferSelect, "paymentStatus" | "source" | "surveyAnswer" | "createdAt">;

/** The survey to show on an order's page, or null: it's off, already answered, too old, or not a paid order the buyer placed. */
export function surveyFor(shop: Pick<Shop, "survey">, order: SurveyOrder, now = new Date()) {
  if (!shop.survey || order.surveyAnswer) return null;
  if (!(PAID as readonly string[]).includes(order.paymentStatus)) return null;
  // Replacements, repeat deliveries and add-ons follow an order the buyer already placed.
  if (order.source !== "checkout" && order.source !== "payment_link") return null;
  if (now.getTime() - order.createdAt.getTime() > ANSWER_DAYS * 86_400_000) return null;
  return shop.survey;
}

/** The buyer's answer, from their order's page. They answer once. */
export async function answerSurvey(db: Db, shop: Shop, orderRef: string, input: { answer: string; other?: string | null }) {
  const order = await db.query.orders.findFirst({ where: and(eq(schema.orders.shopId, shop.id), eq(schema.orders.paymentIntentId, orderRef)) });
  if (!order) throw new NotFoundError("Order");
  if (order.surveyAnswer) throw new UserError("You've already answered. Thank you!");
  const survey = surveyFor(shop, order);
  if (!survey) throw new UserError("This question isn't open any more.");
  const answer = input.answer.trim();
  let other: string | null = null;
  if (answer === SURVEY_OTHER && survey.other) {
    other = (input.other ?? "").trim().replace(/\s+/g, " ") || null;
    if (other && other.length > OTHER_MAX) throw new UserError(`Keep it under ${OTHER_MAX} characters.`);
  } else if (!survey.options.includes(answer)) {
    throw new UserError("Pick one of the answers.");
  }
  await db.update(schema.orders).set({ surveyAnswer: answer, surveyOther: other, updatedAt: new Date() }).where(eq(schema.orders.id, order.id));
  return { answer, other };
}

export type SurveyRow = { answer: string; orders: number; revenueMinor: number; share: number };

/** What buyers answered in the last `days` days: orders and money per answer, and what they typed under "Other". */
export async function surveyReport(db: Db, shopId: string, days: number, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const placed = and(
    eq(schema.orders.shopId, shopId),
    inArray(schema.orders.paymentStatus, [...PAID]),
    inArray(schema.orders.source, ["checkout", "payment_link"]),
    gte(schema.orders.createdAt, since),
  );
  const orders = await db
    .select({ answer: schema.orders.surveyAnswer, totalMinor: schema.orders.totalMinor, refundedMinor: schema.orders.refundedMinor })
    .from(schema.orders)
    .where(placed);
  const byAnswer = new Map<string, { orders: number; revenueMinor: number }>();
  let answered = 0;
  for (const o of orders) {
    if (!o.answer) continue;
    answered++;
    const row = byAnswer.get(o.answer) ?? { orders: 0, revenueMinor: 0 };
    row.orders++;
    row.revenueMinor += o.totalMinor - o.refundedMinor;
    byAnswer.set(o.answer, row);
  }
  const rows: SurveyRow[] = [...byAnswer]
    .map(([answer, r]) => ({ answer, ...r, share: answered ? r.orders / answered : 0 }))
    .sort((a, b) => b.orders - a.orders || b.revenueMinor - a.revenueMinor || a.answer.localeCompare(b.answer));
  const others = await db
    .select({ text: schema.orders.surveyOther, number: schema.orders.number })
    .from(schema.orders)
    .where(and(placed, isNotNull(schema.orders.surveyOther), ne(schema.orders.surveyOther, "")))
    .orderBy(desc(schema.orders.createdAt))
    .limit(20);
  return { rows, orders: orders.length, answered, others: others as { text: string; number: number }[] };
}
