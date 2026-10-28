// Holiday returns: "Bought between Nov 1 and Dec 24? Return it until Jan 31." Gifts often get
// opened weeks after they're bought, so a store can keep returns open longer for orders paid in a
// holiday stretch. The buyer's order page, the returns policy and product pages (while the stretch
// is on) say so, and the normal return window still applies when it's the later of the two.
import { eq } from "drizzle-orm";
import { schema, type Db, type HolidayReturns } from "@sf/db";
import { UserError } from "./errors";

type Shop = typeof schema.shops.$inferSelect;

const DAY = 86_400_000;

function parseDay(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).toISOString().slice(0, 10) === value.trim() ? t : null;
}

/** Sets the holiday stretch and how long its orders can be returned, or removes it with null. */
export async function setHolidayReturns(db: Db, shop: Pick<Shop, "id" | "returnWindowDays">, input: HolidayReturns | null, now = new Date()) {
  let value: HolidayReturns | null = null;
  if (input) {
    if (!shop.returnWindowDays) throw new UserError("Set a return window first. Holiday returns make it longer.");
    const [from, to, until] = [parseDay(input.from), parseDay(input.to), parseDay(input.until)];
    if (from === null || to === null || until === null) throw new UserError("Pick all three dates.");
    if (to < from) throw new UserError("The last order day can't be before the first.");
    if (until <= to) throw new UserError("Returns have to stay open after the last order day.");
    if (until < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) throw new UserError("Pick a return date that hasn't passed.");
    if (until > from + 365 * DAY) throw new UserError("Keep holiday returns within a year of the first order day.");
    value = { from: input.from.trim(), to: input.to.trim(), until: input.until.trim() };
  }
  await db.update(schema.shops).set({ holidayReturns: value, updatedAt: new Date() }).where(eq(schema.shops.id, shop.id));
  return value;
}

/** The end of the holiday return date for an order paid at `paidAt`, or null when it wasn't paid in the stretch. */
export function holidayReturnsUntil(shop: Pick<Shop, "holidayReturns" | "returnWindowDays">, paidAt: Date | null) {
  const h = shop.holidayReturns;
  if (!h || !shop.returnWindowDays || !paidAt) return null;
  const [from, to, until] = [parseDay(h.from), parseDay(h.to), parseDay(h.until)];
  if (from === null || to === null || until === null) return null;
  const t = paidAt.getTime();
  return t >= from && t < to + DAY ? new Date(until + DAY - 1) : null;
}

/** The holiday stretch's dates (midnight UTC) while its returns are still open, for the returns policy; else null. */
export function holidayReturnsDates(shop: Pick<Shop, "holidayReturns" | "returnWindowDays">, now = new Date()) {
  const h = shop.holidayReturns;
  if (!h || !shop.returnWindowDays) return null;
  const [from, to, until] = [parseDay(h.from), parseDay(h.to), parseDay(h.until)];
  if (from === null || to === null || until === null || now.getTime() >= until + DAY) return null;
  return { from: new Date(from), to: new Date(to), until: new Date(until) };
}

/** For product pages: the holiday return date while orders placed now get it, else null. */
export function holidayReturnsNow(shop: Pick<Shop, "holidayReturns" | "returnWindowDays">, now = new Date()) {
  return holidayReturnsUntil(shop, now) ? holidayReturnsDates(shop, now)!.until : null;
}
