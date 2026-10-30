// Gift returns: the person who got a gift can send it back without asking the buyer. Every gift
// order gets a code, printed on its packing slip and in the recipient's "it's on its way" email.
// With it, the recipient asks for a return on the store's /gift-return page; the merchant can only
// answer with store credit for them (or decline), and the emails go to the recipient, so the
// buyer is never refunded or told.
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";

type Order = typeof schema.orders.$inferSelect;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => {
  const c = [...randomBytes(10)].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${c.slice(0, 5)}-${c.slice(5)}`;
};

/** A new gift's details with its return code. */
export const withReturnCode = <T extends NonNullable<Order["gift"]>>(gift: T): T => ({ ...gift, returnCode: gift.returnCode ?? newCode() });

/** The gift's return code, made now for gifts ordered before codes existed. Null when it isn't a gift. */
export async function giftReturnCode(db: Db, order: Pick<Order, "id" | "gift">) {
  if (!order.gift) return null;
  if (order.gift.returnCode) return order.gift.returnCode;
  const gift = withReturnCode(order.gift);
  // Only if nobody made one in the meantime, so a printed code never changes.
  const [row] = await db
    .update(schema.orders)
    .set({ gift })
    .where(and(eq(schema.orders.id, order.id), sql`${schema.orders.gift}->>'returnCode' is null`))
    .returning({ gift: schema.orders.gift });
  if (row) return gift.returnCode!;
  return (await db.query.orders.findFirst({ where: eq(schema.orders.id, order.id), columns: { gift: true } }))?.gift?.returnCode ?? null;
}

/** "abcde fghjk" or "ABCDE-FGHJK" as printed. */
export const normalizeGiftReturnCode = (code: string) => {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 10 ? `${c.slice(0, 5)}-${c.slice(5)}` : null;
};

/** The gift order a return code belongs to, in this store. */
export async function findGiftOrder(db: Db, shopId: string, code: string) {
  const clean = normalizeGiftReturnCode(code);
  if (!clean) return null;
  return (await db.query.orders.findFirst({ where: and(eq(schema.orders.shopId, shopId), sql`${schema.orders.gift}->>'returnCode' = ${clean}`) })) ?? null;
}
