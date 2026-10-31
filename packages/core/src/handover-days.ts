// Pickup and delivery days: a store that hands over orders itself (local pickup, local delivery)
// can let buyers pick the day at checkout, from the weekdays it's open and with the notice it needs.
import { eq } from "drizzle-orm";
import { schema, type Db, type HandoverDays } from "@sf/db";
import { UserError } from "./errors";
import { CUTOFF_TIME_ZONES } from "./ship-cutoff";

/** How far ahead buyers can pick, in calendar days from the first day the store can do. */
export const HANDOVER_DAYS_AHEAD = 14;
export const HANDOVER_LEAD_MAX = 7;

export async function setHandoverDays(db: Db, shopId: string, input: HandoverDays | null) {
  let value: HandoverDays | null = null;
  if (input) {
    const weekdays = [...new Set(input.weekdays)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
    if (!weekdays.length) throw new UserError("Tick at least one day.");
    if (!Number.isInteger(input.leadDays) || input.leadDays < 0 || input.leadDays > HANDOVER_LEAD_MAX) throw new UserError(`Pick 0 to ${HANDOVER_LEAD_MAX} days' notice.`);
    if (!CUTOFF_TIME_ZONES.some(([z]) => z === input.timeZone)) throw new UserError("Pick your time zone.");
    value = { weekdays, leadDays: input.leadDays, timeZone: input.timeZone };
  }
  await db.update(schema.shops).set({ handoverDays: value, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return value;
}

/** Today's date in a time zone, as YYYY-MM-DD. */
function today(timeZone: string, now: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The days a buyer can pick (YYYY-MM-DD, store time), soonest first. */
export function handoverDates(days: HandoverDays, now = new Date()) {
  const start = Date.parse(`${today(days.timeZone, now)}T12:00:00Z`);
  const out: string[] = [];
  for (let i = days.leadDays; i < days.leadDays + HANDOVER_DAYS_AHEAD; i++) {
    const d = new Date(start + i * 86_400_000);
    if (days.weekdays.includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** "Tuesday, November 4" in a language, for a YYYY-MM-DD day. */
export function formatHandoverDay(day: string, lang = "en-US") {
  return new Intl.DateTimeFormat(lang, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}
