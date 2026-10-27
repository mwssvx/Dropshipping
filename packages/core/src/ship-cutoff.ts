// Same-day cutoff: "Order within 2 h 14 min and it ships today". A store that packs its own orders
// (or whose supplier ships the same day) can say what time orders must be in by, in its own time
// zone, and whether it ships at weekends. Orders after the cutoff, or on a day it doesn't ship,
// start the next shipping day; processing days count shipping days only. Product pages show the
// countdown, and delivery dates follow it.
import { eq } from "drizzle-orm";
import { schema, type Db, type ShipCutoff } from "@sf/db";
import { UserError } from "./errors";

const DAY = 86_400_000;

/** Time zones a store can pick for its cutoff, with what to call them. */
export const CUTOFF_TIME_ZONES: [string, string][] = [
  ["America/New_York", "New York (Eastern)"],
  ["America/Chicago", "Chicago (Central)"],
  ["America/Denver", "Denver (Mountain)"],
  ["America/Phoenix", "Phoenix (Arizona)"],
  ["America/Los_Angeles", "Los Angeles (Pacific)"],
  ["America/Anchorage", "Anchorage (Alaska)"],
  ["Pacific/Honolulu", "Honolulu (Hawaii)"],
  ["America/Toronto", "Toronto (Eastern)"],
  ["America/Winnipeg", "Winnipeg (Central)"],
  ["America/Edmonton", "Edmonton (Mountain)"],
  ["America/Vancouver", "Vancouver (Pacific)"],
  ["America/Halifax", "Halifax (Atlantic)"],
  ["Europe/London", "London"],
  ["Europe/Dublin", "Dublin"],
  ["Europe/Lisbon", "Lisbon"],
  ["Europe/Paris", "Paris"],
  ["Europe/Berlin", "Berlin"],
  ["Europe/Madrid", "Madrid"],
  ["Europe/Rome", "Rome"],
  ["Europe/Amsterdam", "Amsterdam"],
  ["Europe/Brussels", "Brussels"],
  ["Europe/Vienna", "Vienna"],
  ["Europe/Stockholm", "Stockholm"],
  ["Europe/Warsaw", "Warsaw"],
  ["Europe/Athens", "Athens"],
  ["Europe/Helsinki", "Helsinki"],
  ["Australia/Sydney", "Sydney"],
];

const DEFAULT_ZONE: Record<string, string> = {
  US: "America/New_York", CA: "America/Toronto", GB: "Europe/London", IE: "Europe/Dublin", PT: "Europe/Lisbon", FR: "Europe/Paris", DE: "Europe/Berlin",
  ES: "Europe/Madrid", IT: "Europe/Rome", NL: "Europe/Amsterdam", BE: "Europe/Brussels", AT: "Europe/Vienna", SE: "Europe/Stockholm", PL: "Europe/Warsaw",
  GR: "Europe/Athens", FI: "Europe/Helsinki", AU: "Australia/Sydney",
};

/** The time zone a store in this country most likely packs in. */
export const defaultCutoffZone = (country: string) => DEFAULT_ZONE[country] ?? "Europe/London";

/** Sets the same-day cutoff, or turns it off with null. */
export async function setShipCutoff(db: Db, shopId: string, input: ShipCutoff | null) {
  if (input) {
    if (!Number.isInteger(input.hour) || input.hour < 1 || input.hour > 23) throw new UserError("Pick a cutoff time.");
    if (!CUTOFF_TIME_ZONES.some(([z]) => z === input.timeZone)) throw new UserError("Pick your time zone.");
  }
  const value = input ? { hour: input.hour, timeZone: input.timeZone, weekends: !!input.weekends } : null;
  await db.update(schema.shops).set({ shipCutoff: value, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return value;
}

/** The local calendar day and hour at an instant, in a time zone. */
function local(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { day: Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)), hour: Number(parts.hour), minute: Number(parts.minute) };
}

/** The instant a local day (as UTC midnight of that date) reaches `hour` in a time zone. */
function instantAt(day: number, hour: number, timeZone: string) {
  let guess = day + hour * 3_600_000;
  // Two passes settle the offset, daylight saving changes included.
  for (let i = 0; i < 2; i++) {
    const seen = local(new Date(guess), timeZone);
    guess += day + hour * 3_600_000 - (seen.day + seen.hour * 3_600_000 + seen.minute * 60_000);
  }
  return new Date(guess);
}

const ships = (day: number, c: ShipCutoff) => c.weekends || ![0, 6].includes(new Date(day).getUTCDay());
const nextShipDay = (day: number, c: ShipCutoff) => {
  let d = day + DAY;
  while (!ships(d, c)) d += DAY;
  return d;
};

/**
 * The day an order placed at `at` leaves, as midnight UTC of that local date: the first shipping
 * day it's in by the cutoff, then `processingDays` more shipping days.
 */
export function shipDay(at: Date, processingDays: number, c: ShipCutoff) {
  const now = local(at, c.timeZone);
  let day = ships(now.day, c) && now.hour < c.hour ? now.day : nextShipDay(now.day, c);
  for (let i = 0; i < processingDays; i++) day = nextShipDay(day, c);
  return new Date(day);
}

/**
 * The next cutoff from `at` and the day orders in by then leave, for the product page countdown.
 * `today` is true when that's the buyer's same local day in the store's time zone.
 */
export function nextCutoff(at: Date, processingDays: number, c: ShipCutoff) {
  const now = local(at, c.timeZone);
  const day = ships(now.day, c) && now.hour < c.hour ? now.day : nextShipDay(now.day, c);
  const deadline = instantAt(day, c.hour, c.timeZone);
  let leaves = day;
  for (let i = 0; i < processingDays; i++) leaves = nextShipDay(leaves, c);
  return { deadline, shipsOn: new Date(leaves), today: leaves === now.day, msLeft: deadline.getTime() - at.getTime() };
}
