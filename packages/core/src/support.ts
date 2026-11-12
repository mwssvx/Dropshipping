import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { addMessage, setConversationStatus } from "./ai/conversations";
import { NotFoundError, UserError } from "./errors";
import type { PlanId } from "./plans";

/*
 * Help from a person, with a promised answer time. Shopify's biggest complaint is support that
 * never reaches a human; here any merchant can write to our team, sees by when a person will
 * answer, and staff see who's waiting longest. Paid plans get a faster promise.
 */

/** Hours until a person from our team answers, any day of the week. */
export const SUPPORT_HOURS: Record<PlanId, number> = { free: 24, starter: 24, growth: 12, scale: 4 };

type Msg = { author: string; status: string; createdAt: Date };

export type SupportWait = { waitingSince: Date; dueAt: Date; overdue: boolean };

/** When the person asking started waiting for us (their first message since our last answer), or null if we answered last. */
export function waitingSince(messages: Msg[], openedAt: Date): Date | null {
  const sent = messages.filter((m) => m.status === "sent").sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const lastStaff = sent.map((m) => m.author).lastIndexOf("staff");
  const after = sent.slice(lastStaff + 1).filter((m) => m.author === "merchant" || m.author === "buyer");
  if (lastStaff < 0) return after[0]?.createdAt ?? openedAt;
  return after[0]?.createdAt ?? null;
}

/** By when a person answers, for a conversation waiting on our team. */
export function supportWait(messages: Msg[], openedAt: Date, plan: PlanId, now = new Date()): SupportWait | null {
  const since = waitingSince(messages, openedAt);
  if (!since) return null;
  const dueAt = new Date(since.getTime() + SUPPORT_HOURS[plan] * 3_600_000);
  return { waitingSince: since, dueAt, overdue: now > dueAt };
}

async function shopPlan(db: Db, shopId: string): Promise<PlanId> {
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId), columns: { plan: true } });
  if (!shop) throw new NotFoundError("Store");
  return shop.plan;
}

/** A merchant writes to our team directly, without going through the assistant. */
export async function openTicket(db: Db, shopId: string, input: { subject: string; body: string }) {
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (subject.length < 3) throw new UserError("Say in a few words what it's about.");
  if (body.length < 10) throw new UserError("Tell us what happened, in a sentence or two.");
  if (subject.length > 120) throw new UserError("Keep the subject under 120 characters.");
  if (body.length > 5000) throw new UserError("Keep the message under 5,000 characters.");
  const [c] = await db
    .insert(schema.conversations)
    .values({ shopId, kind: "ticket", subject, status: "escalated", statusReason: "Written by the merchant" })
    .returning();
  await addMessage(db, c!.id, { author: "merchant", body });
  return c!;
}

/** The merchant adds to one of their tickets; it goes back to waiting on us, even if it was closed. */
export async function replyToTicket(db: Db, shopId: string, conversationId: string, body: string) {
  const c = await db.query.conversations.findFirst({
    where: and(eq(schema.conversations.id, conversationId), eq(schema.conversations.shopId, shopId), eq(schema.conversations.kind, "ticket")),
  });
  if (!c) throw new NotFoundError("Request");
  const text = body.trim();
  if (text.length < 2) throw new UserError("Write your reply first.");
  if (text.length > 5000) throw new UserError("Keep the message under 5,000 characters.");
  await addMessage(db, c.id, { author: "merchant", body: text });
  await setConversationStatus(db, c.id, "escalated", c.statusReason);
}

/** A store's requests to our team, newest first, each with its messages and when a person answers. */
export async function listTickets(db: Db, shopId: string, now = new Date()) {
  const plan = await shopPlan(db, shopId);
  const tickets = await db.query.conversations.findMany({
    where: and(eq(schema.conversations.shopId, shopId), eq(schema.conversations.kind, "ticket")),
    orderBy: desc(schema.conversations.updatedAt),
    limit: 50,
  });
  const ids = tickets.map((t) => t.id);
  const messages = ids.length
    ? await db.query.messages.findMany({ where: inArray(schema.messages.conversationId, ids), orderBy: asc(schema.messages.createdAt) })
    : [];
  return {
    hours: SUPPORT_HOURS[plan],
    plan,
    tickets: tickets.map((t) => {
      const mine = messages.filter((m) => m.conversationId === t.id && m.status === "sent");
      return { ticket: t, messages: mine, wait: t.status === "escalated" ? supportWait(mine, t.createdAt, plan, now) : null };
    }),
  };
}

/**
 * How we kept the promise over the last `days` days: every staff answer counts, timed from when
 * the person started waiting. Shown to staff, so a slipping team is visible before merchants feel it.
 */
export async function supportRecord(db: Db, days = 30, now = new Date()) {
  const from = new Date(now.getTime() - days * 86_400_000);
  const answered = await db
    .selectDistinct({ id: schema.messages.conversationId })
    .from(schema.messages)
    .where(and(eq(schema.messages.author, "staff"), gte(schema.messages.createdAt, from)));
  const ids = answered.map((r) => r.id);
  if (!ids.length) return { answered: 0, onTime: 0, medianMinutes: null as number | null };
  const convos = await db
    .select({ id: schema.conversations.id, createdAt: schema.conversations.createdAt, plan: schema.shops.plan })
    .from(schema.conversations)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.conversations.shopId))
    // Staff answers to a ticket are copied into the merchant's assistant chat; count them once.
    .where(and(inArray(schema.conversations.id, ids), inArray(schema.conversations.kind, ["ticket", "buyer"])));
  const messages = await db.query.messages.findMany({ where: inArray(schema.messages.conversationId, ids), orderBy: asc(schema.messages.createdAt) });
  const waits: number[] = [];
  let onTime = 0;
  for (const c of convos) {
    const mine = messages.filter((m) => m.conversationId === c.id && m.status === "sent");
    mine.forEach((m, i) => {
      if (m.author !== "staff" || m.createdAt < from) return;
      const since = waitingSince(mine.slice(0, i), c.createdAt);
      if (!since) return; // a second staff message in a row isn't an answer to anything new
      const minutes = (m.createdAt.getTime() - since.getTime()) / 60_000;
      waits.push(minutes);
      if (minutes <= SUPPORT_HOURS[c.plan] * 60) onTime++;
    });
  }
  waits.sort((a, b) => a - b);
  const median = waits.length ? waits[Math.floor((waits.length - 1) / 2)]! : null;
  return { answered: waits.length, onTime, medianMinutes: median === null ? null : Math.round(median) };
}

/** "3 hours", "40 minutes", "2 days": for showing a wait or a promise. */
export function formatWait(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return m === 1 ? "1 minute" : `${m} minutes`;
  const h = Math.round(m / 60);
  if (h < 48) return h === 1 ? "1 hour" : `${h} hours`;
  const d = Math.round(h / 24);
  return `${d} days`;
}
