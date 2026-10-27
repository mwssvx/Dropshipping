// Tips at checkout. Some stores (a small roaster, a maker who packs every order by hand) have buyers
// who'd like to say thanks. The store picks up to three percentages; checkout shows them with what
// each comes to, and "No tip" is always first and picked. A tip is on the goods after any discount,
// isn't taxed, and is all the store's: our per-sale fee never touches it.
import { eq } from "drizzle-orm";
import { schema, type Db, type Tipping } from "@sf/db";
import { UserError } from "./errors";

export const MAX_TIP_CHOICES = 3;
export const MAX_TIP_PERCENT = 30;

/** Turns tips at checkout on with the percentages buyers can pick, or off (null). */
export async function setTipping(db: Db, shopId: string, input: { percents: number[]; note?: string | null } | null) {
  let value: Tipping | null = null;
  if (input) {
    const percents = [...new Set(input.percents)].sort((a, b) => a - b);
    if (!percents.length) throw new UserError("Add at least one tip percentage.");
    if (percents.length > MAX_TIP_CHOICES) throw new UserError(`Offer up to ${MAX_TIP_CHOICES} tip amounts.`);
    if (percents.some((p) => !Number.isInteger(p) || p < 1 || p > MAX_TIP_PERCENT)) throw new UserError(`Keep each tip between 1% and ${MAX_TIP_PERCENT}%.`);
    const note = (input.note ?? "").trim() || null;
    if (note && note.length > 120) throw new UserError("Keep the thank-you line under 120 characters.");
    value = { percents, note };
  }
  await db.update(schema.shops).set({ tipping: value, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return value;
}

/** What a tip of this percent comes to on goods worth `baseMinor`, rounded to the cent. */
export function tipAmount(baseMinor: number, percent: number) {
  return baseMinor > 0 && percent > 0 ? Math.round((baseMinor * percent) / 100) : 0;
}
