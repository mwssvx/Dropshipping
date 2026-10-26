// Saved replies: the merchant's own answers to the questions buyers ask most, kept once and put
// into the inbox's reply box with a click. Fields in braces are filled from the conversation: the
// buyer's first name, the order number, its tracking link and the store's name. A field that can't
// be filled (no order, no tracking yet) stays in braces, and the reply can't be sent until it's
// replaced, so a buyer never gets "{tracking_link}".
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";

export const MAX_SAVED_REPLIES = 30;
export type SavedReply = typeof schema.savedReplies.$inferSelect;

export const REPLY_FIELDS = {
  "{first_name}": "the buyer's first name",
  "{order_number}": "the order number, like #1043",
  "{tracking_link}": "the order's tracking link",
  "{store_name}": "your store's name",
} as const;
type Field = keyof typeof REPLY_FIELDS;
const FIELDS = Object.keys(REPLY_FIELDS) as Field[];

/** Answers most stores need, to start from. They're plain saved replies once added. */
export const STARTER_REPLIES: { title: string; body: string }[] = [
  {
    title: "Where is my order",
    body: "Hi {first_name},\n\nThanks for waiting. Order {order_number} is on its way, and you can follow it here: {tracking_link}\n\nIf it hasn't arrived a few days after the tracking says it should, reply here and we'll sort it out.",
  },
  {
    title: "How long shipping takes",
    body: "Hi {first_name},\n\nOrders usually leave us within 1 to 3 days and arrive 7 to 15 days after that. As soon as order {order_number} ships, we'll email you its tracking.",
  },
  {
    title: "Returns",
    body: "Hi {first_name},\n\nSorry it didn't work out. You can start a return from your order page (the link is below this message), and we'll email you the next steps.",
  },
];

const replyInput = z.object({
  title: z.string().trim().min(1, "Give the reply a short name, like \"Where is my order\".").max(60, "Keep the name under 60 characters."),
  body: z.string().trim().min(2, "Write the reply.").max(2000, "Keep the reply under 2,000 characters."),
});
export type SavedReplyInput = z.input<typeof replyInput>;

export async function listSavedReplies(db: Db, shopId: string) {
  return db.query.savedReplies.findMany({ where: eq(schema.savedReplies.shopId, shopId), orderBy: asc(schema.savedReplies.title) });
}

async function checkName(db: Db, shopId: string, title: string, except?: string) {
  const all = await listSavedReplies(db, shopId);
  if (all.some((r) => r.id !== except && r.title.toLowerCase() === title.toLowerCase())) throw new UserError(`You already have a reply called "${title}".`);
  return all.length;
}

/** Adds a saved reply, or changes one when an id is given. */
export async function saveSavedReply(db: Db, shopId: string, input: SavedReplyInput & { id?: string }, now = new Date()) {
  const parsed = replyInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { title, body } = parsed.data;
  if (input.id) {
    const existing = await db.query.savedReplies.findFirst({ where: and(eq(schema.savedReplies.id, input.id), eq(schema.savedReplies.shopId, shopId)) });
    if (!existing) throw new NotFoundError("Saved reply");
    await checkName(db, shopId, title, existing.id);
    const [row] = await db.update(schema.savedReplies).set({ title, body, updatedAt: now }).where(eq(schema.savedReplies.id, existing.id)).returning();
    return row!;
  }
  const n = await checkName(db, shopId, title);
  if (n >= MAX_SAVED_REPLIES) throw new UserError(`A store can have up to ${MAX_SAVED_REPLIES} saved replies. Delete one you no longer use first.`);
  const [row] = await db.insert(schema.savedReplies).values({ shopId, title, body, createdAt: now, updatedAt: now }).returning();
  return row!;
}

export async function deleteSavedReply(db: Db, shopId: string, id: string) {
  await db.delete(schema.savedReplies).where(and(eq(schema.savedReplies.id, id), eq(schema.savedReplies.shopId, shopId)));
}

/** Adds the starter replies the store doesn't already have a reply of the same name for. */
export async function addStarterReplies(db: Db, shopId: string) {
  const have = new Set((await listSavedReplies(db, shopId)).map((r) => r.title.toLowerCase()));
  const missing = STARTER_REPLIES.filter((r) => !have.has(r.title.toLowerCase())).slice(0, Math.max(0, MAX_SAVED_REPLIES - have.size));
  if (missing.length) await db.insert(schema.savedReplies).values(missing.map((r) => ({ shopId, ...r })));
  return missing.length;
}

/** Puts the known values into a reply; fields without one stay in braces. */
export function fillReply(body: string, values: Partial<Record<Field, string>>) {
  return body.replace(/\{(first_name|order_number|tracking_link|store_name)\}/g, (field) => values[field as Field] ?? field);
}

/** The fields still in braces, which have to be replaced before the reply goes out. */
export function unfilledFields(text: string) {
  return FIELDS.filter((f) => text.includes(f));
}

/** What the fields stand for in one conversation. */
async function fieldValues(db: Db, shopId: string, conversationId: string) {
  const c = await db.query.conversations.findFirst({ where: and(eq(schema.conversations.id, conversationId), eq(schema.conversations.shopId, shopId)) });
  if (!c) throw new NotFoundError("Conversation");
  const shop = (await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId), columns: { name: true } }))!;
  const values: Partial<Record<Field, string>> = { "{store_name}": shop.name };
  const order = c.orderId ? await db.query.orders.findFirst({ where: eq(schema.orders.id, c.orderId) }) : null;
  // A contact-page message has no order; its subject carries the name the buyer gave.
  const name = order?.shippingAddress.name ?? /^Message from (.+)$/.exec(c.subject)?.[1] ?? "";
  values["{first_name}"] = name.trim().split(/\s+/)[0] || "there";
  if (order) {
    values["{order_number}"] = `#${order.number}`;
    const parcel = await db.query.fulfillments.findFirst({
      where: and(eq(schema.fulfillments.orderId, order.id), isNotNull(schema.fulfillments.trackingNumber)),
      orderBy: desc(schema.fulfillments.shippedAt),
    });
    const link = parcel?.trackingUrl ?? parcel?.trackingNumber;
    if (link) values["{tracking_link}"] = link;
  }
  return values;
}

/** The store's saved replies, filled in for one conversation, for the reply box. */
export async function savedRepliesFor(db: Db, shopId: string, conversationId: string) {
  const [replies, values] = await Promise.all([listSavedReplies(db, shopId), fieldValues(db, shopId, conversationId)]);
  return replies.map((r) => {
    const text = fillReply(r.body, values);
    return { id: r.id, title: r.title, text, missing: unfilledFields(text) };
  });
}
