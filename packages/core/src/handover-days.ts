// Pickup and delivery days: a store that hands over orders itself (local pickup, local delivery)
// can let buyers pick the day at checkout, from the weekdays it's open and with the notice it needs.
import { and, eq, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
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

/** How many coming days the order list sums up, today included. */
export const HANDOVER_SCHEDULE_DAYS = 7;

/**
 * The pickups and local deliveries due over the coming week (store time), for the order list:
 * paid orders with a picked day that haven't been handed over yet. Today always comes first, even
 * with nothing due; later days show only when something is. Earlier days still waiting are summed
 * up as `overdue`.
 */
export async function handoverSchedule(db: Db, shopId: string, days: HandoverDays, now = new Date()) {
  const first = today(days.timeZone, now);
  const start = Date.parse(`${first}T12:00:00Z`);
  const last = new Date(start + (HANDOVER_SCHEDULE_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const o = schema.orders;
  const rows = await db
    .select({ day: o.handoverOn, pickup: o.pickup, n: sql<number>`count(*)::int` })
    .from(o)
    .where(and(eq(o.shopId, shopId), isNotNull(o.handoverOn), lte(o.handoverOn, last), inArray(o.paymentStatus, ["paid", "partially_refunded"]), ne(o.fulfillmentStatus, "delivered")))
    .groupBy(o.handoverOn, o.pickup);
  const byDay = new Map<string, { pickups: number; deliveries: number }>();
  let overdue = 0;
  for (const r of rows) {
    if (r.day! < first) {
      overdue += r.n;
      continue;
    }
    const entry = byDay.get(r.day!) ?? { pickups: 0, deliveries: 0 };
    if (r.pickup) entry.pickups += r.n;
    else entry.deliveries += r.n;
    byDay.set(r.day!, entry);
  }
  const out: { day: string; today: boolean; pickups: number; deliveries: number }[] = [];
  for (let i = 0; i < HANDOVER_SCHEDULE_DAYS; i++) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    const entry = byDay.get(day);
    if (i === 0 || entry) out.push({ day, today: i === 0, pickups: entry?.pickups ?? 0, deliveries: entry?.deliveries ?? 0 });
  }
  return { days: out, overdue, today: first };
}

/** A YYYY-MM-DD day from a link, or undefined when it isn't one. */
export function handoverParam(value: string | null | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) ? value : undefined;
}
