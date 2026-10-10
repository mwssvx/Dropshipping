// "Track your order" for buyers without an account: they enter their email and order number, and
// we email that address the link to the order's status page. The page itself never says whether
// an order was found, so it can't be used to check who bought what.
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema } from "@sf/db";
import { z } from "zod";
import { UserError } from "./errors";
import { sendOrderEmail, type FulfillmentContext } from "./fulfillment";

type Shop = typeof schema.shops.$inferSelect;

/** One link email per order per ten minutes, however often the form is sent. */
const WINDOW_MS = 10 * 60_000;

const lookupInput = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  number: z
    .string()
    .trim()
    .transform((v) => v.replace(/^#/, ""))
    .pipe(z.string().regex(/^\d{1,9}$/).transform(Number)),
});

export async function requestOrderLink(ctx: FulfillmentContext, shop: Shop, input: { email: string; number: string }) {
  const parsed = lookupInput.safeParse(input);
  if (!parsed.success) throw new UserError("Enter your email and the order number from your confirmation, like 1001.", "invalid");
  const { email, number } = parsed.data;
  const order = await ctx.db.query.orders.findFirst({
    where: and(
      eq(schema.orders.shopId, shop.id),
      eq(schema.orders.number, number),
      sql`lower(${schema.orders.email}) = ${email}`,
      inArray(schema.orders.paymentStatus, ["paid", "partially_refunded", "refunded"]),
    ),
  });
  if (order) {
    const now = (ctx.now?.() ?? new Date()).getTime();
    await sendOrderEmail(ctx, order.id, "order_link", String(Math.floor(now / WINDOW_MS)));
  }
  return { status: "sent" as const };
}
