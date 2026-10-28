/**
 * How the owner writes to buyers, learned from the drafts they rewrite. When the owner edits a
 * reply the buyer helper drafted before sending it, their version is kept (the last few), and the
 * helper's instructions show them as examples of tone, length and sign-off. Only the owner's own
 * words are kept, never the buyer's message, so nothing a buyer wrote reaches the instructions.
 */
import { eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";

export const REPLY_EXAMPLES_MAX = 5;
const EXAMPLE_CHARS = 600;

export type ReplyExample = { topic: string; reply: string; at: string };

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Keeps the owner's version of a reply when it differs from the draft. Returns whether it was kept. */
export async function learnFromEdit(db: Db, shopId: string, e: { topic: string; draft: string; sent: string; now?: Date }) {
  if (norm(e.draft) === norm(e.sent) || e.sent.trim().length < 20) return false;
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId), columns: { aiReplyExamples: true } });
  const example: ReplyExample = { topic: e.topic, reply: e.sent.trim().slice(0, EXAMPLE_CHARS), at: (e.now ?? new Date()).toISOString() };
  const kept = [example, ...(shop?.aiReplyExamples ?? []).filter((x) => norm(x.reply) !== norm(example.reply))].slice(0, REPLY_EXAMPLES_MAX);
  await db.update(schema.shops).set({ aiReplyExamples: kept }).where(eq(schema.shops.id, shopId));
  return true;
}

export function exampleInstructions(examples: ReplyExample[] | null | undefined) {
  if (!examples?.length) return "";
  return `\nThe owner rewrote some of your earlier drafts before sending them. Write like these: their tone, length, greeting and sign-off. They were about other orders, so never take facts from them.\n${examples
    .map((x, i) => `<owner_reply n="${i + 1}" topic="${x.topic}">\n${x.reply}\n</owner_reply>`)
    .join("\n")}`;
}
