// Payment links: the merchant builds an order for a buyer who asked by message, phone or in
// person, and we email them a link to pay. It's an ordinary order from then on: the same prices,
// shipping, tax and fees as checkout, and once paid it goes to the supplier like any other.
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Address, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { sendOrderEmail } from "./fulfillment";
import { startCheckout, type CartLine } from "./orders";
import type { RefundContext } from "./refunds";
import { BuiltInTaxCalculator, type TaxCalculator } from "./tax";

type Shop = typeof schema.shops.$inferSelect;

/** How many times one link can be emailed. */
export const MAX_LINK_SENDS = 5;

export async function createPaymentLink(
  ctx: RefundContext,
  shop: Shop,
  input: { email: string; address: Address; lines: CartLine[]; discountCode?: string | null; shippingRateId?: string | null; note?: string | null },
  taxCalculator: TaxCalculator = new BuiltInTaxCalculator(),
) {
  const lines = input.lines.filter((l) => l.quantity > 0);
  if (!lines.length) throw new UserError("Add at least one product.");
  const note = input.note?.trim().slice(0, 1000) || null;
  const { order } = await startCheckout(
    ctx.db,
    ctx.payments,
    shop,
    { email: input.email, address: input.address, lines, discountCode: input.discountCode || null, shippingRateId: input.shippingRateId || null, taxExemptFor: input.email },
    taxCalculator,
  );
  const [row] = await ctx.db.update(schema.orders).set({ source: "payment_link", note }).where(eq(schema.orders.id, order.id)).returning();
  const sent = await sendOrderEmail(ctx, order.id, "payment_link", "1");
  return { order: row!, sent: sent.status === "sent" };
}

/** Emails the link again, up to MAX_LINK_SENDS times in all. */
export async function resendPaymentLink(ctx: RefundContext, shopId: string, orderId: string) {
  const order = await ctx.db.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId)) });
  if (!order || order.source !== "payment_link") throw new NotFoundError("Payment link");
  if (order.paymentStatus !== "pending" && order.paymentStatus !== "failed") throw new UserError("This order is already paid.");
  const sends = await ctx.db.query.emails.findMany({ where: and(eq(schema.emails.orderId, order.id), eq(schema.emails.kind, "payment_link")), columns: { id: true } });
  if (sends.length >= MAX_LINK_SENDS) throw new UserError(`The link has been emailed ${MAX_LINK_SENDS} times. Copy it and send it another way.`);
  const sent = await sendOrderEmail(ctx, order.id, "payment_link", String(sends.length + 1));
  if (sent.status !== "sent") throw new UserError("The email didn't go out. Try again in a minute, or copy the link and send it yourself.");
}

/** Payment links still waiting to be paid, for the Orders page. */
export async function countUnpaidLinks(db: Db, shopId: string) {
  const rows = await db.query.orders.findMany({
    where: and(eq(schema.orders.shopId, shopId), eq(schema.orders.source, "payment_link"), inArray(schema.orders.paymentStatus, ["pending", "failed"])),
    columns: { id: true },
  });
  return rows.length;
}
