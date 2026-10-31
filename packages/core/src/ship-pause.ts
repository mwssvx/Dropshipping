// A break in shipping while the store keeps selling: a supplier closed for Chinese New Year, or a
// merchant with their own stock away for a week. Unlike a holiday break (store-closure.ts), buyers
// can still order. Every page says when orders ship again, and delivery dates count from that day,
// so nobody is promised a parcel that can't leave yet. It can be set ahead and ends by itself.
import { eq } from "drizzle-orm";
import { schema, type Db, type ShipPause } from "@sf/db";
import { UserError } from "./errors";

type Shop = typeof schema.shops.$inferSelect;

const DAY = 86_400_000;
/** The longest a pause can last. */
export const SHIP_PAUSE_MAX_DAYS = 45;
export const SHIP_PAUSE_MESSAGE_MAX = 300;

const dayStart = (date: string) => new Date(`${date}T00:00:00Z`);
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(dayStart(d).getTime()) && dayStart(d).toISOString().slice(0, 10) === d;

/** Sets a pause from `from` (or now) until shipping resumes on `resumesOn`, or removes it with null. */
export async function setShipPause(db: Db, shopId: string, input: { from?: string | null; resumesOn: string; message?: string | null } | null, now = new Date()) {
  let value: ShipPause | null = null;
  if (input) {
    const today = now.toISOString().slice(0, 10);
    const resumesOn = input.resumesOn.trim();
    const from = input.from?.trim() || null;
    if (!isDate(resumesOn) || (from && !isDate(from))) throw new UserError("Enter the dates as YYYY-MM-DD.");
    if (resumesOn <= today) throw new UserError("Pick a day after today for shipping to start again.");
    const start = from && from > today ? from : today;
    if (from && from >= resumesOn) throw new UserError("The pause has to start before shipping starts again.");
    if (dayStart(resumesOn).getTime() - dayStart(start).getTime() > SHIP_PAUSE_MAX_DAYS * DAY) throw new UserError(`A pause can last up to ${SHIP_PAUSE_MAX_DAYS} days.`);
    if (dayStart(start).getTime() - now.getTime() > 365 * DAY) throw new UserError("Pick dates within the next year.");
    const message = input.message?.trim() || null;
    if (message && message.length > SHIP_PAUSE_MESSAGE_MAX) throw new UserError(`Keep the message under ${SHIP_PAUSE_MESSAGE_MAX} characters.`);
    value = { from: start, resumesOn, message };
  }
  await db.update(schema.shops).set({ shipPause: value, updatedAt: now }).where(eq(schema.shops.id, shopId));
  return value;
}

/** The pause while it's on: null before it starts and from the day shipping resumes. */
export function activeShipPause(shop: Pick<Shop, "shipPause">, now = new Date()) {
  const p = shop.shipPause;
  if (!p) return null;
  if (now >= dayStart(p.resumesOn)) return null;
  if (p.from && now < dayStart(p.from)) return null;
  return { ...p, resumes: dayStart(p.resumesOn) };
}

/**
 * When an order placed at `at` starts being prepared: the day shipping resumes when it was placed
 * during the pause, otherwise `at`. Delivery dates count from here.
 */
export function shippingStart(shop: Pick<Shop, "shipPause">, at: Date) {
  return activeShipPause(shop, at)?.resumes ?? at;
}
