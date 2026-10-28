// The thank-you note: a few lines the store writes for buyers who just paid ("Follow us on
// Instagram for new colours", "Each lamp is packed by hand, so it ships in 2 days"). It shows on the
// order page and in the order confirmation email, as plain text.
import { eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { UserError } from "./errors";

export const THANK_YOU_NOTE_MAX = 500;

/** Saves the note, or removes it when empty. Returns what was saved. */
export async function setThankYouNote(db: Db, shopId: string, note: string | null) {
  const clean = note?.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim() || null;
  if (clean && clean.length > THANK_YOU_NOTE_MAX) throw new UserError(`Keep the thank-you note under ${THANK_YOU_NOTE_MAX} characters.`);
  await db.update(schema.shops).set({ thankYouNote: clean, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return clean;
}
