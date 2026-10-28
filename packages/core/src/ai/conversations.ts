import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { learnFromEdit } from "./examples";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "../errors";
import type { FulfillmentContext } from "../fulfillment";
import { unfilledFields } from "../saved-replies";

type Conversation = typeof schema.conversations.$inferSelect;
type Message = typeof schema.messages.$inferSelect;

export const BUYER_TOPICS = {
  order_status: "Where is my order",
  shipping_time: "How long shipping takes",
  returns: "Returns and exchanges",
  product_question: "Questions about a product",
  other: "Anything else",
} as const;
export type BuyerTopic = keyof typeof BUYER_TOPICS;

const now = (ctx: { now?: () => Date }) => ctx.now?.() ?? new Date();

export async function addMessage(
  db: Db,
  conversationId: string,
  m: { author: Message["author"]; body: string; status?: Message["status"]; topic?: string | null },
) {
  const [row] = await db
    .insert(schema.messages)
    .values({ conversationId, author: m.author, body: m.body, status: m.status ?? "sent", topic: m.topic ?? null })
    .returning();
  await db.update(schema.conversations).set({ updatedAt: new Date() }).where(eq(schema.conversations.id, conversationId));
  return row!;
}

export async function setConversationStatus(db: Db, conversationId: string, status: Conversation["status"], reason: string | null = null) {
  await db
    .update(schema.conversations)
    .set({ status, statusReason: reason, updatedAt: new Date() })
    .where(eq(schema.conversations.id, conversationId));
}

/** A buyer writes from their order page. The order's link is the buyer's proof they placed it. */
export async function startBuyerMessage(db: Db, input: { shopId: string; paymentIntentId: string; body: string }) {
  const body = input.body.trim();
  if (body.length < 3) throw new UserError("Write your question first.");
  if (body.length > 4000) throw new UserError("Please keep your message under 4,000 characters.");
  const order = await db.query.orders.findFirst({
    where: and(eq(schema.orders.shopId, input.shopId), eq(schema.orders.paymentIntentId, input.paymentIntentId)),
  });
  if (!order) throw new NotFoundError("Order");
  await db
    .insert(schema.conversations)
    .values({ shopId: order.shopId, kind: "buyer", orderId: order.id, email: order.email, subject: `Order #${order.number}` })
    .onConflictDoNothing();
  const conversation = (await db.query.conversations.findFirst({
    where: and(eq(schema.conversations.orderId, order.id), eq(schema.conversations.kind, "buyer")),
  }))!;
  // Too many unanswered messages in a row looks like abuse; the merchant still sees them all.
  const recent = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .where(and(eq(schema.messages.conversationId, conversation.id), eq(schema.messages.author, "buyer"), sql`${schema.messages.createdAt} > now() - interval '1 hour'`));
  if (Number(recent[0]?.n ?? 0) >= 5) throw new UserError("You've sent several messages already. The store will reply soon.");
  const message = await addMessage(db, conversation.id, { author: "buyer", body });
  if (conversation.status === "resolved") await setConversationStatus(db, conversation.id, "open");
  return { conversation, message, order };
}

/** Messages a buyer can see on their order page: theirs and the replies that were sent. */
export async function buyerThread(db: Db, shopId: string, paymentIntentId: string) {
  const order = await db.query.orders.findFirst({
    where: and(eq(schema.orders.shopId, shopId), eq(schema.orders.paymentIntentId, paymentIntentId)),
    columns: { id: true },
  });
  if (!order) return [];
  const c = await db.query.conversations.findFirst({
    where: and(eq(schema.conversations.orderId, order.id), eq(schema.conversations.kind, "buyer")),
  });
  if (!c) return [];
  const rows = await db.query.messages.findMany({ where: eq(schema.messages.conversationId, c.id), orderBy: asc(schema.messages.createdAt) });
  return rows.filter((m) => m.status === "sent" && m.author !== "staff");
}

/** Send a drafted or typed reply to the buyer by email, once. */
export async function sendBuyerMessage(ctx: FulfillmentContext, messageId: string, body?: string) {
  const { db } = ctx;
  const message = await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
  if (!message) throw new NotFoundError("Message");
  const c = (await db.query.conversations.findFirst({ where: eq(schema.conversations.id, message.conversationId) }))!;
  if (c.kind !== "buyer" || !c.email) throw new UserError("This conversation has no buyer to write to.");
  if (message.status === "discarded") throw new UserError("That draft was discarded.");
  const text = (body ?? message.body).trim();
  if (text.length < 2) throw new UserError("Write a reply first.");
  const missing = unfilledFields(text);
  if (missing.length) throw new UserError(`Replace ${missing.join(" and ")} in the reply first: this conversation has nothing to fill it with yet.`, "unfilled_field");
  const order = c.orderId ? ((await db.query.orders.findFirst({ where: eq(schema.orders.id, c.orderId) })) ?? null) : null;
  const shop = (await db.query.shops.findFirst({ where: eq(schema.shops.id, c.shopId) }))!;
  let subject: string;
  let fullText: string;
  if (order) {
    subject = `Re: your order #${order.number} from ${shop.name}`;
    fullText = `${text}\n\n—\n${shop.name}\nSee your order and reply here: ${await ctx.orderStatusUrl(shop, order)}`;
  } else {
    // No order to key the sent email on, so the message's own status says whether it went.
    if (message.status === "sent") return { status: "already_sent" as const };
    // A message from the contact page: the buyer writes there again to reply.
    const contact = ctx.storeAddress ? `${await ctx.storeAddress(shop)}/contact` : null;
    subject = `Re: your message to ${shop.name}`;
    fullText = `${text}\n\n—\n${shop.name}${contact ? `\nTo reply, write to us again: ${contact}` : ""}`;
  }
  const [email] = await db
    .insert(schema.emails)
    .values({ shopId: shop.id, orderId: order?.id ?? null, kind: "support_reply", ref: message.id, to: c.email, subject, bodyText: fullText })
    .onConflictDoNothing()
    .returning({ id: schema.emails.id });
  await db.update(schema.messages).set({ status: "sent", body: text }).where(eq(schema.messages.id, message.id));
  await setConversationStatus(db, c.id, c.status === "escalated" ? "escalated" : "resolved");
  if (!email) return { status: "already_sent" as const };
  try {
    const { id } = await ctx.mailer.send({ to: c.email, subject, text: fullText });
    await db.update(schema.emails).set({ status: "sent", providerMessageId: id, sentAt: now(ctx) }).where(eq(schema.emails.id, email.id));
    return { status: "sent" as const };
  } catch (e) {
    await db.update(schema.emails).set({ status: "failed", error: e instanceof Error ? e.message : String(e) }).where(eq(schema.emails.id, email.id));
    return { status: "failed" as const };
  }
}

/** The merchant writes to a buyer themselves. */
export async function merchantReply(ctx: FulfillmentContext, shopId: string, conversationId: string, body: string) {
  const c = await ctx.db.query.conversations.findFirst({
    where: and(eq(schema.conversations.id, conversationId), eq(schema.conversations.shopId, shopId)),
  });
  if (!c) throw new NotFoundError("Conversation");
  if (body.trim().length < 2) throw new UserError("Write a reply first.");
  const missing = unfilledFields(body);
  if (missing.length) throw new UserError(`Replace ${missing.join(" and ")} in the reply first: this conversation has nothing to fill it with yet.`, "unfilled_field");
  // Writing their own reply over the helper's draft is a rewrite too: the helper learns from it.
  const draft = await ctx.db.query.messages.findFirst({ where: and(eq(schema.messages.conversationId, c.id), eq(schema.messages.status, "draft"), eq(schema.messages.author, "agent")) });
  if (draft) await learnFromEdit(ctx.db, shopId, { topic: draft.topic ?? "other", draft: draft.body, sent: body });
  const m = await addMessage(ctx.db, c.id, { author: "merchant", body: body.trim(), status: "draft" });
  // A reply from the merchant replaces any draft the assistant left.
  await discardDrafts(ctx.db, c.id, m.id);
  return sendBuyerMessage(ctx, m.id);
}

export async function discardDrafts(db: Db, conversationId: string, except?: string) {
  const drafts = await db.query.messages.findMany({
    where: and(eq(schema.messages.conversationId, conversationId), eq(schema.messages.status, "draft")),
  });
  const ids = drafts.map((d) => d.id).filter((id) => id !== except);
  if (!ids.length) return;
  await db.update(schema.messages).set({ status: "discarded" }).where(inArray(schema.messages.id, ids));
  // Their approval requests go too, so nothing waits on a draft that's gone.
  await db
    .update(schema.agentActions)
    .set({ status: "rejected", decidedBy: "Replaced by your reply", decidedAt: new Date() })
    .where(and(eq(schema.agentActions.status, "pending"), sql`${schema.agentActions.input}->>'message_id' in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`));
}

export async function listInbox(db: Db, shopId: string, filter: "needs_you" | "all" = "all") {
  const rows = await db.query.conversations.findMany({
    where: and(
      eq(schema.conversations.shopId, shopId),
      eq(schema.conversations.kind, "buyer"),
      filter === "needs_you" ? inArray(schema.conversations.status, ["needs_merchant", "escalated", "open"]) : undefined,
    ),
    orderBy: desc(schema.conversations.updatedAt),
    limit: 100,
  });
  const last = rows.length
    ? await db
        .select({ conversationId: schema.messages.conversationId, body: schema.messages.body, author: schema.messages.author, status: schema.messages.status })
        .from(schema.messages)
        .where(inArray(schema.messages.conversationId, rows.map((r) => r.id)))
        .orderBy(desc(schema.messages.createdAt))
    : [];
  return rows.map((c) => {
    const mine = last.filter((m) => m.conversationId === c.id);
    return { ...c, last: mine[0] ?? null, drafts: mine.filter((m) => m.status === "draft").length };
  });
}

export async function getConversation(db: Db, shopId: string, conversationId: string) {
  const c = await db.query.conversations.findFirst({
    where: and(eq(schema.conversations.id, conversationId), eq(schema.conversations.shopId, shopId)),
  });
  if (!c) throw new NotFoundError("Conversation");
  const messages = await db.query.messages.findMany({ where: eq(schema.messages.conversationId, c.id), orderBy: asc(schema.messages.createdAt) });
  const order = c.orderId ? await db.query.orders.findFirst({ where: eq(schema.orders.id, c.orderId) }) : null;
  return { conversation: c, messages, order: order ?? null };
}

export async function countNeedsYou(db: Db, shopId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.shopId, shopId), eq(schema.conversations.kind, "buyer"), inArray(schema.conversations.status, ["needs_merchant", "escalated"])));
  return Number(row?.n ?? 0);
}

/* Platform staff: tickets the merchant assistant opened and buyer conversations handed to us. */

export async function listEscalations(db: Db) {
  const rows = await db
    .select({ conversation: schema.conversations, shopName: schema.shops.name })
    .from(schema.conversations)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.conversations.shopId))
    .where(eq(schema.conversations.status, "escalated"))
    .orderBy(asc(schema.conversations.updatedAt))
    .limit(200);
  return rows;
}

export async function getEscalation(db: Db, conversationId: string) {
  const c = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, conversationId) });
  if (!c) throw new NotFoundError("Conversation");
  const shop = (await db.query.shops.findFirst({ where: eq(schema.shops.id, c.shopId) }))!;
  const messages = await db.query.messages.findMany({ where: eq(schema.messages.conversationId, c.id), orderBy: asc(schema.messages.createdAt) });
  return { conversation: c, shop, messages };
}

/** Staff answer a ticket (the merchant sees it in their assistant) and optionally close it. */
export async function staffReply(db: Db, conversationId: string, input: { body: string; close: boolean; by: string }) {
  const c = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, conversationId) });
  if (!c) throw new NotFoundError("Conversation");
  const body = input.body.trim();
  if (body.length < 5) throw new UserError("Write a reply of at least a sentence.");
  await addMessage(db, c.id, { author: "staff", body });
  if (c.kind === "ticket") {
    // Tickets show up in the merchant's assistant chat as a message from our team.
    const chat = await assistantConversation(db, c.shopId);
    await addMessage(db, chat.id, { author: "staff", body: `Our support team replied to "${c.subject}":\n\n${body}` });
  }
  await setConversationStatus(db, c.id, input.close ? "resolved" : "escalated", input.close ? `Closed by ${input.by}` : c.statusReason);
}

/** Each store has one running chat with its assistant. */
export async function assistantConversation(db: Db, shopId: string) {
  const found = await db.query.conversations.findFirst({
    where: and(eq(schema.conversations.shopId, shopId), eq(schema.conversations.kind, "assistant")),
  });
  if (found) return found;
  const [created] = await db.insert(schema.conversations).values({ shopId, kind: "assistant", subject: "Assistant" }).returning();
  return created!;
}

export async function assistantMessages(db: Db, shopId: string, limit = 50) {
  const c = await assistantConversation(db, shopId);
  const rows = await db.query.messages.findMany({
    where: eq(schema.messages.conversationId, c.id),
    orderBy: desc(schema.messages.createdAt),
    limit,
  });
  return rows.reverse();
}
