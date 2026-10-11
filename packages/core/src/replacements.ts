// Replacements: when a package is lost, arrives damaged or has the wrong thing in it, the merchant
// sends the items again for free. The replacement is its own order (no charge, no invoice), linked
// to the first, and goes to the supplier like any other, so it gets tracking and emails.
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { routeAndIssue, sendOrderEmail, type FulfillmentContext } from "./fulfillment";

type Shop = typeof schema.shops.$inferSelect;
type Order = typeof schema.orders.$inferSelect;

const SHIPPED = ["partially_shipped", "shipped", "delivered"] as const;

const replacementInput = z.object({
  items: z.array(z.object({ lineId: z.string().uuid(), quantity: z.number().int().min(0).max(99) })),
  note: z.string().trim().max(1000, "Keep the note under 1,000 characters.").optional(),
});
export type ReplacementInput = z.input<typeof replacementInput>;

/** The lines that can be sent again: goods, not gift cards. */
export async function replaceableLines(db: Db, orderId: string) {
  const rows = await db
    .select({ line: schema.orderLines, giftCard: schema.products.giftCard })
    .from(schema.orderLines)
    .leftJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .leftJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(eq(schema.orderLines.orderId, orderId))
    .orderBy(asc(schema.orderLines.title));
  return rows.filter((r) => !r.giftCard && r.line.variantId).map((r) => r.line);
}

/** Why an order can't be replaced right now, or null when it can. */
export function replacementBlocked(order: Order) {
  if (order.paymentStatus === "refunded") return "This order was refunded, so there's nothing to replace.";
  if (!["paid", "partially_refunded"].includes(order.paymentStatus)) return "This order isn't paid.";
  if (!(SHIPPED as readonly string[]).includes(order.fulfillmentStatus)) return `Order #${order.number} hasn't shipped yet. Change or cancel it instead.`;
  return null;
}

/**
 * Sends the chosen items again, free, as a new order linked to this one. The buyer gets an email
 * saying so, and the supplier gets the order as usual. Returns the new order.
 */
export async function sendReplacement(ctx: FulfillmentContext, shop: Shop, orderId: string, input: ReplacementInput) {
  const { db } = ctx;
  const parsed = replacementInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const order = await db.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shop.id)) });
  if (!order) throw new NotFoundError("Order");
  const blocked = replacementBlocked(order);
  if (blocked) throw new UserError(blocked);
  const lines = await replaceableLines(db, order.id);
  const wanted = parsed.data.items.filter((i) => i.quantity > 0);
  if (!wanted.length) throw new UserError("Pick at least one item to send again.");
  for (const i of wanted) {
    const line = lines.find((l) => l.id === i.lineId);
    if (!line) throw new UserError("That item isn't in this order.");
    if (i.quantity > line.quantity) throw new UserError(`The order had ${line.quantity} of ${line.title}.`);
  }
  // What the goods cost now, so the profit report counts the replacement as the loss it is.
  const variants = await db.query.variants.findMany({ where: inArray(schema.variants.id, lines.map((l) => l.variantId!)) });
  const costOf = (variantId: string, fallback: number | null) => variants.find((v) => v.id === variantId)?.costMinor ?? fallback;
  const now = ctx.now?.() ?? new Date();

  const replacement = await db.transaction(async (tx) => {
    // Lock the shop row so a checkout at the same moment can't take the same order number.
    await tx.execute(sql`select 1 from ${schema.shops} where ${schema.shops.id} = ${shop.id} for update`);
    const [{ next }] = (await tx
      .select({ next: sql<number>`coalesce(max(${schema.orders.number}), 1000) + 1` })
      .from(schema.orders)
      .where(eq(schema.orders.shopId, shop.id))) as [{ next: number }];
    const [row] = await tx
      .insert(schema.orders)
      .values({
        shopId: shop.id,
        number: Number(next),
        customerId: order.customerId,
        email: order.email,
        shippingAddress: order.shippingAddress,
        currency: order.currency,
        subtotalMinor: 0,
        shippingMinor: 0,
        taxMinor: 0,
        totalMinor: 0,
        shippingMethod: order.shippingMethod,
        gift: order.gift,
        source: "replacement",
        replacesOrderId: order.id,
        note: parsed.data.note || null,
        // Nothing is charged, so the reference is ours; it's also what the order page link uses.
        paymentIntentId: `replacement_${randomUUID()}`,
        paymentStatus: "paid",
        paidAt: now,
        // The first order already passed (or was cleared by) the risk check.
        riskReviewedAt: now,
      })
      .returning();
    await tx.insert(schema.orderLines).values(
      wanted.map((i) => {
        const line = lines.find((l) => l.id === i.lineId)!;
        return { orderId: row!.id, variantId: line.variantId, title: line.title, quantity: i.quantity, unitPriceMinor: 0, unitCostMinor: costOf(line.variantId!, line.unitCostMinor), personalization: line.personalization };
      }),
    );
    return row!;
  });
  await sendOrderEmail(ctx, replacement.id, "order_confirmation");
  await routeAndIssue(ctx, replacement.id);
  return (await db.query.orders.findFirst({ where: eq(schema.orders.id, replacement.id) }))!;
}

/** Replacements sent for an order, oldest first, for its pages. */
export async function replacementsOf(db: Db, orderId: string) {
  return db.query.orders.findMany({ where: eq(schema.orders.replacesOrderId, orderId), orderBy: asc(schema.orders.createdAt) });
}
