// Holiday deadline: "Order by Dec 15 to get it in time for Christmas". The merchant names a day and
// the last date orders can arrive, and product pages work out the last day to order from the same
// delivery window they show. Once that day has passed they say an order may not make it, and after
// the arrive-by date the line goes away on its own.
import { eq } from "drizzle-orm";
import { schema, type Db, type HolidayDeadline, type ShipCutoff } from "@sf/db";
import { UserError } from "./errors";
import { lateShipDay, localDay } from "./ship-cutoff";

const DAY = 86_400_000;
export const HOLIDAY_NAME_MAX = 40;
/** How far ahead the arrive-by date can be. */
export const HOLIDAY_DAYS_AHEAD = 365;

const startOfUtcDay = (at: Date) => Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());

function parseDay(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).toISOString().slice(0, 10) === value ? t : null;
}

/** Sets the holiday orders should arrive in time for, or removes it with null. */
export async function setHolidayDeadline(db: Db, shopId: string, input: { name: string; arriveBy: string } | null, now = new Date()) {
  let value: HolidayDeadline | null = null;
  if (input) {
    const name = input.name.trim().replace(/\s+/g, " ");
    if (!name) throw new UserError("Name the day, like Christmas.");
    if (name.length > HOLIDAY_NAME_MAX) throw new UserError(`Keep the name under ${HOLIDAY_NAME_MAX} characters.`);
    const day = parseDay(input.arriveBy.trim());
    if (day === null) throw new UserError("Pick the last day orders can arrive.");
    const today = startOfUtcDay(now);
    if (day <= today) throw new UserError("Pick a day after today.");
    if (day > today + HOLIDAY_DAYS_AHEAD * DAY) throw new UserError("Pick a day within a year.");
    value = { name, arriveBy: input.arriveBy.trim() };
  }
  await db.update(schema.shops).set({ holidayDeadline: value, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return value;
}

/**
 * The last day to order so even the slowest delivery arrives by the holiday's arrive-by date, as
 * midnight UTC of that date. A day counts only if an order placed at any time that day makes it, so
 * with a same-day cutoff it's judged as if the order came in after the cutoff. `orderBy` is null
 * when it's too late to order now, and `today` says the last day is today (in the store's time
 * zone with a cutoff). The whole result is null once the arrive-by date has passed.
 * `w` is the delivery window for an order placed now.
 */
export function holidayOrderBy(
  deadline: HolidayDeadline | null,
  w: { processingDays: number; transitMax: number; to: Date },
  cutoff: ShipCutoff | null | undefined,
  now: Date,
) {
  if (!deadline) return null;
  const arriveBy = parseDay(deadline.arriveBy);
  if (arriveBy === null) return null;
  const arriveEnd = arriveBy + DAY - 1;
  if (now.getTime() > arriveEnd) return null;
  // The latest an order placed at any time on a day could arrive: with a cutoff that's an order in
  // after it, on the store's local date; otherwise one at the very end of the UTC day.
  const lastArrival = (day: number) =>
    cutoff ? lateShipDay(day, w.processingDays, cutoff).getTime() + w.transitMax * DAY : day + DAY - 1 + (w.processingDays + w.transitMax) * DAY;
  const today = cutoff ? localDay(now, cutoff) : startOfUtcDay(now);
  for (let day = arriveBy; day >= today; day -= DAY) {
    if (lastArrival(day) <= arriveEnd) return { name: deadline.name, arriveBy: new Date(arriveBy), orderBy: new Date(day), today: day === today };
  }
  // Late in the day, ordering right now (before the cutoff) can still make it.
  const inTime = w.to.getTime() <= arriveEnd;
  return { name: deadline.name, arriveBy: new Date(arriveBy), orderBy: inTime ? new Date(today) : null, today: inTime };
}
