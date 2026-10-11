// The store's contact page. A buyer writes in with their name, email and message, and it lands in
// the merchant's inbox. When they give an order number that matches their email, the message joins
// that order's conversation, so buyer support can answer with the order in front of it; otherwise it
// starts a conversation of its own for the merchant, who replies by email from the inbox.
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { UserError } from "./errors";
import { addMessage, setConversationStatus } from "./ai/conversations";

type Shop = typeof schema.shops.$inferSelect;

const PER_EMAIL_PER_HOUR = 3;
const PER_STORE_PER_HOUR = 50;

const contactInput = z.object({
  name: z.string().trim().min(1, "Tell us your name.").max(100, "Keep your name to 100 characters."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  order: z.string().trim().max(20).optional(),
  message: z.string().trim().min(10, "Write a little more, so the store can help.").max(4000, "Please keep your message under 4,000 characters."),
  /** A field people never see; bots fill it in. */
  website: z.string().optional(),
});

/**
 * Takes a message from the contact page. Gives the conversation it went to, and the order when it
 * joined one (the caller then lets buyer support answer). Null when it looked like a bot: the form
 * thanks them the same way, so they learn nothing.
 */
export async function sendContactMessage(db: Db, shop: Pick<Shop, "id">, input: z.input<typeof contactInput>, now = new Date()) {
  const parsed = contactInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { name, email, message, website } = parsed.data;
  if (website?.trim()) return null;
  const hourAgo = new Date(now.getTime() - 3_600_000);

  // An order number counts only with the email it was placed with, so nobody can write into
  // someone else's order.
  const number = Number((parsed.data.order ?? "").replace(/^#/, ""));
  const order =
    Number.isInteger(number) && number > 0
      ? await db.query.orders.findFirst({ where: and(eq(schema.orders.shopId, shop.id), eq(schema.orders.number, number), sql`lower(${schema.orders.email}) = ${email}`) })
      : undefined;

  const [mine] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
    .where(and(eq(schema.conversations.shopId, shop.id), eq(schema.messages.author, "buyer"), sql`lower(${schema.conversations.email}) = ${email}`, gt(schema.messages.createdAt, hourAgo)));
  if (Number(mine?.n ?? 0) >= PER_EMAIL_PER_HOUR) throw new UserError("You've sent several messages already. The store will reply soon.");
  const [all] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.shopId, shop.id), eq(schema.conversations.kind, "buyer"), isNull(schema.conversations.orderId), gt(schema.conversations.createdAt, hourAgo)));
  if (Number(all?.n ?? 0) >= PER_STORE_PER_HOUR) throw new UserError("The store is getting a lot of messages right now. Please try again in an hour.");

  if (order) {
    await db
      .insert(schema.conversations)
      .values({ shopId: shop.id, kind: "buyer", orderId: order.id, email: order.email, subject: `Order #${order.number}` })
      .onConflictDoNothing();
    const conversation = (await db.query.conversations.findFirst({ where: and(eq(schema.conversations.orderId, order.id), eq(schema.conversations.kind, "buyer")) }))!;
    await addMessage(db, conversation.id, { author: "buyer", body: message });
    if (conversation.status === "resolved") await setConversationStatus(db, conversation.id, "open");
    return { conversationId: conversation.id, orderId: order.id };
  }

  const [conversation] = await db
    .insert(schema.conversations)
    .values({ shopId: shop.id, kind: "buyer", email, subject: `Message from ${name}`, status: "needs_merchant", statusReason: "Sent from your contact page" })
    .returning();
  await addMessage(db, conversation!.id, { author: "buyer", body: message });
  return { conversationId: conversation!.id, orderId: null };
}
