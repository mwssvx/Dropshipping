// Closing the store for a while. Before launch a merchant can hide it behind a password page, so
// only people they give the password to (friends, testers) can see it, while everyone else can
// leave their email to hear when it opens. On a holiday break buyers can still look around but
// can't order, and every page says when the store is back. Either can end by itself on a date.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type Db, type StoreClosure } from "@sf/db";
import { hashPassword, verifyPassword } from "./auth";
import { UserError } from "./errors";

type Shop = typeof schema.shops.$inferSelect;

const MAX_DAYS_AHEAD = 365;
/** The cookie that remembers a visitor gave this store's password. */
export const storeAccessCookie = (shopId: string) => `sf_store_access_${shopId}`;

/** The day a date-only string starts, in UTC. */
const dayStart = (date: string) => new Date(`${date}T00:00:00Z`);
const today = (now: Date) => now.toISOString().slice(0, 10);

/**
 * Opens the store, or closes it with a password page or for a holiday. A password page keeps its
 * password when none is given, so the merchant can change the message without retyping it.
 */
export async function setStoreClosure(
  db: Db,
  shop: Pick<Shop, "id" | "closure">,
  input: { mode: "open" | "password" | "holiday"; message?: string | null; until?: string | null; password?: string | null },
  now = new Date(),
): Promise<StoreClosure | null> {
  if (input.mode === "open") {
    await db.update(schema.shops).set({ closure: null, updatedAt: now }).where(eq(schema.shops.id, shop.id));
    return null;
  }
  if (input.mode !== "password" && input.mode !== "holiday") throw new UserError("Pick whether the store is open, behind a password, or on a break.");
  const message = (input.message ?? "").trim() || null;
  if (message && message.length > 500) throw new UserError("Keep the message to 500 characters.");
  const until = (input.until ?? "").trim() || null;
  if (until) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || Number.isNaN(dayStart(until).getTime()) || dayStart(until).toISOString().slice(0, 10) !== until) throw new UserError("Enter the date as YYYY-MM-DD.");
    if (until <= today(now)) throw new UserError("Pick a date after today, or leave it empty to open the store yourself.");
    if (dayStart(until).getTime() - now.getTime() > MAX_DAYS_AHEAD * 86_400_000) throw new UserError("Pick a date within the next year.");
  }
  let passwordHash: string | null = null;
  let accessKey: string | null = null;
  if (input.mode === "password") {
    const password = (input.password ?? "").trim();
    const kept = shop.closure?.mode === "password" && shop.closure.passwordHash && shop.closure.accessKey ? shop.closure : null;
    if (password) {
      if (password.length < 4 || password.length > 100) throw new UserError("Use 4 to 100 characters for the store password.");
      passwordHash = await hashPassword(password);
      // A new password signs everyone out, so people with the old one have to ask again.
      accessKey = randomBytes(24).toString("base64url");
    } else if (kept) {
      passwordHash = kept.passwordHash;
      accessKey = kept.accessKey;
    } else {
      throw new UserError("Choose a password to give the people who may see the store.");
    }
  }
  const closure: StoreClosure = { mode: input.mode, message, until, passwordHash, accessKey };
  await db.update(schema.shops).set({ closure, updatedAt: now }).where(eq(schema.shops.id, shop.id));
  return closure;
}

/** The store's closure while it lasts: null when the store is open or the date to open has come. */
export function activeClosure(shop: Pick<Shop, "closure">, now = new Date()): StoreClosure | null {
  const c = shop.closure;
  if (!c) return null;
  if (c.until && now >= dayStart(c.until)) return null;
  if (c.mode === "password" && (!c.passwordHash || !c.accessKey)) return null;
  return c;
}

/** Whether buyers can place orders now. Repeat deliveries and after-checkout offers carry on. */
export function onHoliday(shop: Pick<Shop, "closure">, now = new Date()) {
  return activeClosure(shop, now)?.mode === "holiday";
}

/** Whether a visitor's cookie lets them past the password page. */
export function hasStoreAccess(shop: Pick<Shop, "closure">, cookie: string | null | undefined, now = new Date()) {
  const c = activeClosure(shop, now);
  if (c?.mode !== "password") return true;
  if (!cookie) return false;
  const a = Buffer.from(cookie);
  const b = Buffer.from(c.accessKey!);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Checks the password a visitor typed. Gives the value for their cookie, or null when it's wrong. */
export async function enterStorePassword(shop: Pick<Shop, "closure">, password: string, now = new Date()): Promise<string | null> {
  const c = activeClosure(shop, now);
  if (c?.mode !== "password") return null;
  const typed = password.trim();
  if (!typed || typed.length > 100) return null;
  return (await verifyPassword(typed, c.passwordHash!)) ? c.accessKey : null;
}
