// Returns. A buyer asks from their order page, within the store's return window, saying which
// items and why. The merchant approves it with instructions (send it back, or keep it), refunds
// it, gives store credit, or declines it, and the buyer is emailed each step. For "it doesn't fit",
// the buyer can ask for another size or colour of the same product at the same price instead, and
// the merchant sends it as a free order.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { RETURN_REASONS, schema, type Db, type ReturnItem } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { issueGiftCard, type GiftCardContext } from "./gift-cards";
import { formatMoney } from "./money";
import { refundOrder, type RefundContext } from "./refunds";
import { sendReplacement } from "./replacements";

type Shop = typeof schema.shops.$inferSelect;
type Order = typeof schema.orders.$inferSelect;
type ReturnRequest = typeof schema.returnRequests.$inferSelect;
export type ReturnContext = RefundContext & GiftCardContext;

export const RETURN_REASON_LABELS: Record<(typeof RETURN_REASONS)[number], string> = {
  never_arrived: "It never arrived",
  damaged: "It arrived damaged",
  wrong_item: "I got the wrong item",
  not_as_described: "It's not as described",
  too_small_or_big: "It doesn't fit",
  changed_mind: "I changed my mind",
  other: "Something else",
};

const DAY = 86_400_000;
export const DEFAULT_RETURN_INSTRUCTIONS = "We'll email you where to send it. Please keep the item and its packaging until then.";

/** When the return window started: delivery, else shipping, else payment. */
async function windowStart(db: Db, order: Order) {
  const fs = await db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, order.id) });
  const latest = (pick: (f: (typeof fs)[number]) => Date | null) =>
    fs.map(pick).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return latest((f) => f.deliveredAt) ?? latest((f) => f.shippedAt) ?? order.paidAt;
}

/** The lines a buyer can return: goods, not gift cards. */
async function returnableLines(db: Db, orderId: string) {
  const rows = await db
    .select({ line: schema.orderLines, giftCard: schema.products.giftCard })
    .from(schema.orderLines)
    .leftJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .leftJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(eq(schema.orderLines.orderId, orderId))
    .orderBy(asc(schema.orderLines.title));
  return rows.filter((r) => !r.giftCard).map((r) => r.line);
}

/**
 * What each line could be swapped for: the product's other options that cost the same as the one
 * bought does now and are in stock. Lines with nothing to swap for are left out.
 */
async function exchangeChoices(db: Db, lines: (typeof schema.orderLines.$inferSelect)[]) {
  const bought = lines.filter((l) => l.variantId);
  if (!bought.length) return {};
  const rows = await db
    .select({ variant: schema.variants, product: { id: schema.products.id, title: schema.products.title, status: schema.products.status } })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(inArray(schema.variants.productId, db.select({ id: schema.variants.productId }).from(schema.variants).where(inArray(schema.variants.id, bought.map((l) => l.variantId!)))))
    .orderBy(asc(schema.variants.position));
  const choices: Record<string, { variantId: string; title: string }[]> = {};
  for (const line of bought) {
    const own = rows.find((r) => r.variant.id === line.variantId);
    if (!own || own.product.status !== "active") continue;
    const others = rows.filter(
      (r) => r.variant.productId === own.variant.productId && r.variant.id !== own.variant.id && r.variant.priceMinor === own.variant.priceMinor && (r.variant.stock === null || r.variant.stock >= line.quantity),
    );
    if (others.length) choices[line.id] = others.map((r) => ({ variantId: r.variant.id, title: r.variant.title === "Default" ? r.product.title : `${r.product.title} – ${r.variant.title}` }));
  }
  return choices;
}

/** For the buyer's order page: whether they can ask, why not, and any request already made. */
export async function returnOptions(db: Db, shop: Shop, order: Order, now = new Date()) {
  const [requests, lines, start] = await Promise.all([
    db.query.returnRequests.findMany({ where: eq(schema.returnRequests.orderId, order.id), orderBy: desc(schema.returnRequests.createdAt) }),
    returnableLines(db, order.id),
    windowStart(db, order),
  ]);
  const exchanges = await exchangeChoices(db, lines);
  const open = requests.find((r) => r.status === "requested" || r.status === "approved") ?? null;
  const closesAt = start ? new Date(start.getTime() + shop.returnWindowDays * DAY) : null;
  let blocked: string | null = null;
  if (!shop.returnWindowDays) blocked = `${shop.name} handles returns by email. Reply to your order confirmation to ask.`;
  else if (!["paid", "partially_refunded"].includes(order.paymentStatus)) blocked = order.paymentStatus === "refunded" ? "This order has been refunded." : "This order isn't paid.";
  else if (!lines.length) blocked = "Nothing in this order can be returned.";
  else if (closesAt && closesAt < now) blocked = `Returns closed ${shop.returnWindowDays} days after delivery.`;
  return { canRequest: !blocked && !open, blocked, open, latest: requests[0] ?? null, closesAt, lines, exchanges };
}

const requestSchema = z.object({
  reason: z.enum(RETURN_REASONS, { error: "Pick a reason." }),
  note: z.string().trim().max(1000, "Keep the note under 1,000 characters.").optional(),
  items: z.array(z.object({ lineId: z.string().uuid(), quantity: z.number().int().min(0).max(99), exchangeVariantId: z.string().optional() })),
});

/** What the chosen items cost the buyer: their share of the discount off, their share of tax on. */
function valueOf(order: Order, lines: (typeof schema.orderLines.$inferSelect)[], items: { lineId: string; quantity: number }[]) {
  const goods = items.reduce((s, i) => s + lines.find((l) => l.id === i.lineId)!.unitPriceMinor * i.quantity, 0);
  const discount = order.subtotalMinor ? Math.round((order.discountMinor * goods) / order.subtotalMinor) : 0;
  const net = goods - discount;
  const taxable = order.subtotalMinor - order.discountMinor;
  const tax = !order.taxIncluded && taxable > 0 ? Math.round((order.taxMinor * net) / taxable) : 0;
  return Math.min(net + tax, order.totalMinor - order.refundedMinor);
}

export async function requestReturn(db: Db, shop: Shop, order: Order, input: z.input<typeof requestSchema>, now = new Date()) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const options = await returnOptions(db, shop, order, now);
  if (options.open) throw new UserError("You've already asked to return items from this order. We'll email you when the store answers.");
  if (!options.canRequest) throw new UserError(options.blocked!);
  const wanted = parsed.data.items.filter((i) => i.quantity > 0);
  if (!wanted.length) throw new UserError("Pick at least one item to return.");
  for (const i of wanted) {
    const line = options.lines.find((l) => l.id === i.lineId);
    if (!line) throw new UserError("That item isn't in this order.");
    if (i.quantity > line.quantity) throw new UserError(`You bought ${line.quantity} of ${line.title}.`);
    if (i.exchangeVariantId && !options.exchanges[i.lineId]?.some((c) => c.variantId === i.exchangeVariantId)) throw new UserError(`That option of ${line.title} can't be swapped for right now.`);
  }
  const swapping = wanted.filter((i) => i.exchangeVariantId);
  if (swapping.length && swapping.length < wanted.length) throw new UserError("Swap every item you're sending back, or none of them. You can ask about the others once this is answered.");
  const items: ReturnItem[] = wanted.map((i) => {
    const swap = i.exchangeVariantId ? options.exchanges[i.lineId]!.find((c) => c.variantId === i.exchangeVariantId)! : null;
    return { lineId: i.lineId, quantity: i.quantity, title: options.lines.find((l) => l.id === i.lineId)!.title, ...(swap ? { exchangeVariantId: swap.variantId, exchangeTitle: swap.title } : {}) };
  });
  const [row] = await db
    .insert(schema.returnRequests)
    .values({
      shopId: shop.id,
      orderId: order.id,
      reason: parsed.data.reason,
      note: parsed.data.note || null,
      items,
      suggestedMinor: valueOf(order, options.lines, wanted),
    })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new UserError("You've already asked to return items from this order. We'll email you when the store answers.");
  return row;
}

export async function listReturns(db: Db, shopId: string, filter: "open" | "all" = "open") {
  const rows = await db
    .select({ request: schema.returnRequests, orderNumber: schema.orders.number, email: schema.orders.email, currency: schema.orders.currency })
    .from(schema.returnRequests)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.returnRequests.orderId))
    .where(
      and(
        eq(schema.returnRequests.shopId, shopId),
        filter === "open" ? inArray(schema.returnRequests.status, ["requested", "approved"]) : undefined,
      ),
    )
    .orderBy(desc(schema.returnRequests.createdAt))
    .limit(200);
  return rows.map((r) => ({ ...r.request, orderNumber: r.orderNumber, email: r.email, currency: r.currency }));
}

export async function countOpenReturns(db: Db, shopId: string) {
  const rows = await db.query.returnRequests.findMany({
    where: and(eq(schema.returnRequests.shopId, shopId), eq(schema.returnRequests.status, "requested")),
    columns: { id: true },
  });
  return rows.length;
}

export async function setReturnSettings(db: Db, shopId: string, input: { windowDays: number; instructions: string }) {
  if (!Number.isInteger(input.windowDays) || input.windowDays < 0 || input.windowDays > 365) throw new UserError("Enter a return window from 0 to 365 days.");
  const instructions = input.instructions.trim().slice(0, 1000) || null;
  await db.update(schema.shops).set({ returnWindowDays: input.windowDays, returnInstructions: instructions, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
}

export type ReturnDecision =
  | { action: "approve"; message?: string }
  | { action: "refund"; amountMinor: number; message?: string }
  | { action: "credit"; amountMinor: number; message?: string }
  | { action: "replace"; message?: string }
  | { action: "exchange"; message?: string }
  | { action: "decline"; message: string };

/** The merchant answers a return. Refund and store credit close it; approve waits for the item. */
export async function decideReturn(ctx: ReturnContext, shop: Shop, requestId: string, decision: ReturnDecision) {
  const request = await ctx.db.query.returnRequests.findFirst({ where: and(eq(schema.returnRequests.id, requestId), eq(schema.returnRequests.shopId, shop.id)) });
  if (!request) throw new NotFoundError("Return");
  if (request.status !== "requested" && request.status !== "approved") throw new UserError("This return is already closed.");
  if (decision.action === "approve" && request.status === "approved") throw new UserError("This return is already approved.");
  const order = (await ctx.db.query.orders.findFirst({ where: eq(schema.orders.id, request.orderId) }))!;
  const message = decision.message?.trim().slice(0, 1000) || null;
  const money = (m: number) => formatMoney(m, order.currency);

  let update: Partial<ReturnRequest> = {};
  let email: string;
  if (decision.action === "decline") {
    if (!message) throw new UserError("Tell the buyer why, so they know what to do next.");
    update = { status: "declined", resolvedAt: new Date() };
    email = `${shop.name} can't accept this return.\n\n${message}`;
  } else if (decision.action === "replace") {
    // The same items again, free. Nothing needs to come back.
    const replacement = await sendReplacement(ctx, shop, order.id, { items: request.items.map((i) => ({ lineId: i.lineId, quantity: i.quantity })), note: message ?? undefined });
    update = { status: "replaced", replacementOrderId: replacement.id, resolvedAt: new Date() };
    email = `${shop.name} is sending you a replacement as order #${replacement.number}. There's nothing to send back. You'll get an email with tracking when it ships.`;
  } else if (decision.action === "exchange") {
    // The other size or colour goes out as a free order; the first one comes back as usual.
    if (!request.items.some((i) => i.exchangeVariantId)) throw new UserError("The buyer didn't ask for an exchange. Send a replacement or refund it instead.");
    const replacement = await sendReplacement(ctx, shop, order.id, {
      items: request.items.map((i) => ({ lineId: i.lineId, quantity: i.quantity, variantId: i.exchangeVariantId })),
      note: message ?? undefined,
    });
    const instructions = message ?? shop.returnInstructions ?? DEFAULT_RETURN_INSTRUCTIONS;
    update = { status: "exchanged", replacementOrderId: replacement.id, merchantMessage: instructions, resolvedAt: new Date() };
    email = `${shop.name} is sending you ${request.items.map((i) => i.exchangeTitle ?? i.title).join(", ")} in exchange, as order #${replacement.number}. You'll get an email with tracking when it ships.\n\nWhat to send back: ${instructions}`;
  } else if (decision.action === "approve") {
    const instructions = message ?? shop.returnInstructions ?? DEFAULT_RETURN_INSTRUCTIONS;
    update = { status: "approved", merchantMessage: instructions };
    email = `${shop.name} approved your return.\n\nWhat to do next: ${instructions}`;
  } else {
    const left = order.totalMinor - order.refundedMinor;
    if (!Number.isInteger(decision.amountMinor) || decision.amountMinor <= 0) throw new UserError("Enter an amount.");
    if (decision.action === "refund") {
      if (decision.amountMinor > left) throw new UserError(`You can refund at most ${money(left)} on this order.`);
      const { refund } = await refundOrder(ctx, shop.id, order.id, { amountMinor: decision.amountMinor, reason: `Return: ${RETURN_REASON_LABELS[request.reason]}` });
      update = { status: "refunded", resolvedMinor: decision.amountMinor, refundId: refund.id, resolvedAt: new Date() };
      email = `${shop.name} refunded ${money(decision.amountMinor)} for your return. You'll get a separate refund email with the details.`;
    } else {
      const { card, sent } = await issueGiftCard(ctx, shop, {
        email: order.email,
        amountMinor: decision.amountMinor,
        note: `Store credit for your return from order #${order.number}.`,
      });
      if (!sent) throw new UserError("The store credit was made but its email didn't go out. Send a new code from Gift cards.");
      update = { status: "credited", resolvedMinor: decision.amountMinor, giftCardId: card.id, resolvedAt: new Date() };
      email = `${shop.name} gave you ${money(decision.amountMinor)} in store credit for your return. The gift card code is in a separate email.`;
    }
  }
  const [row] = await ctx.db
    .update(schema.returnRequests)
    .set({ ...update, merchantMessage: update.merchantMessage ?? message, updatedAt: new Date() })
    .where(and(eq(schema.returnRequests.id, request.id), inArray(schema.returnRequests.status, ["requested", "approved"])))
    .returning();
  const link = await ctx.orderStatusUrl(shop, order);
  await ctx.mailer
    .send({
      to: order.email,
      subject: `Your return for order #${order.number}`,
      text: `Hi ${order.shippingAddress.name.split(" ")[0]},\n\n${email}\n\nItems: ${request.items.map((i) => `${i.title} × ${i.quantity}`).join(", ")}\n\nOrder status: ${link}\n`,
    })
    .catch(() => {});
  return row ?? request;
}
