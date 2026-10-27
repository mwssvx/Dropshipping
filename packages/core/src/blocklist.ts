// Blocked buyers. A buyer who keeps filing chargebacks, ordering with stolen cards or abusing
// returns can be blocked by email or by delivery address, from their order or by hand. Checkout
// turns them away with a plain message before any payment, so they can't cost the store another
// dispute fee. Blocking by address catches the same person behind a new email.
import { and, desc, eq } from "drizzle-orm";
import { schema, type Address, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { postalKey } from "./local-delivery";

export const BLOCKED_MESSAGE = "We can't take this order. If you think this is a mistake, contact the store.";
const NOTE_MAX = 200;

const cleanEmail = (email: string) => email.trim().toLowerCase();

/** One key for a delivery address, so "1 Main St." and "1 main st" at 78701 match. */
export function addressKey(a: Pick<Address, "line1" | "postalCode" | "country">) {
  const street = a.line1.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const postal = postalKey(a.postalCode ?? "");
  return street && postal ? `${a.country.toUpperCase()}|${postal}|${street}` : null;
}

/** Blocks an email, an address, or both. Already-blocked values are left as they are. */
export async function blockBuyer(db: Db, shopId: string, input: { email?: string | null; address?: Address | null; note?: string | null; orderId?: string | null }) {
  const note = (input.note ?? "").trim() || null;
  if (note && note.length > NOTE_MAX) throw new UserError(`Keep the note under ${NOTE_MAX} characters.`);
  const rows: (typeof schema.blockedBuyers.$inferInsert)[] = [];
  if (input.email) {
    const email = cleanEmail(input.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("Enter an email address, like name@example.com.");
    rows.push({ shopId, kind: "email", value: email, label: email, note, orderId: input.orderId ?? null });
  }
  if (input.address) {
    const key = addressKey(input.address);
    if (key) rows.push({ shopId, kind: "address", value: key, label: `${input.address.line1}, ${input.address.postalCode} ${input.address.country}`, note, orderId: input.orderId ?? null });
  }
  if (!rows.length) throw new UserError("Enter an email address to block.");
  return db.insert(schema.blockedBuyers).values(rows).onConflictDoNothing().returning();
}

/** Blocks the email and delivery address of an order's buyer. */
export async function blockOrderBuyer(db: Db, shopId: string, orderId: string, note?: string | null) {
  const order = await db.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId)) });
  if (!order) throw new NotFoundError("Order");
  await blockBuyer(db, shopId, { email: order.email, address: order.pickup ? null : order.shippingAddress, note, orderId });
  return order;
}

export async function unblockBuyer(db: Db, shopId: string, id: string) {
  const [row] = await db.delete(schema.blockedBuyers).where(and(eq(schema.blockedBuyers.id, id), eq(schema.blockedBuyers.shopId, shopId))).returning();
  if (!row) throw new NotFoundError("Blocked buyer");
  return row;
}

export const listBlockedBuyers = (db: Db, shopId: string) =>
  db.query.blockedBuyers.findMany({ where: eq(schema.blockedBuyers.shopId, shopId), orderBy: desc(schema.blockedBuyers.createdAt) });

/** What on this checkout is blocked, or null when nothing is. */
export async function blockedMatch(db: Db, shopId: string, buyer: { email: string; address?: Address | null }) {
  const keys = [{ kind: "email" as const, value: cleanEmail(buyer.email) }];
  const key = buyer.address ? addressKey(buyer.address) : null;
  if (key) keys.push({ kind: "address" as const, value: key });
  for (const k of keys) {
    const hit = await db.query.blockedBuyers.findFirst({ where: and(eq(schema.blockedBuyers.shopId, shopId), eq(schema.blockedBuyers.kind, k.kind), eq(schema.blockedBuyers.value, k.value)) });
    if (hit) return hit;
  }
  return null;
}

/** Whether an order's email or address is on the list, for the order page. */
export async function isOrderBuyerBlocked(db: Db, shopId: string, order: { email: string; shippingAddress: Address | null }) {
  return !!(await blockedMatch(db, shopId, { email: order.email, address: order.shippingAddress }));
}
