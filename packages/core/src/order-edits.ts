// Changing a paid order before it ships: a new delivery address, or another size or colour of the
// same item at the same price. The most common support request in dropshipping ("I put the wrong
// address", "can I have a medium instead"), and one a merchant otherwise handles by cancelling
// with the supplier by hand. The supplier order is cancelled and placed again with the change.
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Address, type Db, type OrderEdit } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { refreshOrderFulfillment, routeOrder, sendOrderEmail, type FulfillmentContext } from "./fulfillment";
import { addressSchema } from "./orders";
import { cancelUnshipped, refundOrder, type RefundContext } from "./refunds";
import { moveLineStock } from "./own-stock";
import { assessOrderRisk, shouldHold } from "./risk";
import { countryName } from "./shipping";
import { can } from "./team";

/** Buyers can change their order themselves for this long after paying, until it ships. */
export const BUYER_EDIT_HOURS = 12;

type Who = OrderEdit["by"];
type Order = typeof schema.orders.$inferSelect;

export type OrderEditOptions = {
  canEdit: boolean;
  /** Why it can't be changed, in words for whoever is asking. */
  reason: string | null;
  /** For buyers: when the chance to change it ends (unless it ships first). */
  until: Date | null;
  address: Address;
  lines: { id: string; title: string; quantity: number; variantId: string | null; choices: { variantId: string; title: string }[] }[];
};

const variantLabel = (productTitle: string, variantTitle: string) => (variantTitle === "Default" ? productTitle : `${productTitle} – ${variantTitle}`);

async function load(ctx: Pick<FulfillmentContext, "db">, shopId: string, orderId: string) {
  const order = await ctx.db.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId)) });
  if (!order) throw new NotFoundError("Order");
  const [lines, fulfillments] = await Promise.all([
    ctx.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) }),
    ctx.db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, order.id) }),
  ]);
  return { order, lines, fulfillments };
}

function blocked(order: Order, fulfillments: (typeof schema.fulfillments.$inferSelect)[], by: Who, now: Date) {
  if (order.paymentStatus !== "paid") return by === "buyer" ? "This order can't be changed online any more." : "Only paid orders that haven't been refunded can be changed.";
  if (fulfillments.some((f) => f.status === "shipped" || f.status === "delivered" || f.trackingNumber) || ["shipped", "partially_shipped", "delivered"].includes(order.fulfillmentStatus)) {
    return "It has already shipped, so it can't be changed.";
  }
  if (by === "buyer") {
    const until = buyerDeadline(order);
    if (!until || now > until) return `Orders can be changed online for ${BUYER_EDIT_HOURS} hours after ordering. Ask the store instead.`;
  }
  return null;
}

const buyerDeadline = (order: Order) => (order.paidAt ? new Date(order.paidAt.getTime() + BUYER_EDIT_HOURS * 3_600_000) : null);

/** What can still be changed on an order, and the sizes or colours each line could switch to. */
export async function orderEditOptions(ctx: Pick<FulfillmentContext, "db" | "now">, shopId: string, orderId: string, by: Who): Promise<OrderEditOptions> {
  const { order, lines, fulfillments } = await load(ctx, shopId, orderId);
  const reason = blocked(order, fulfillments, by, ctx.now?.() ?? new Date());
  const variantIds = lines.map((l) => l.variantId).filter((x): x is string => !!x);
  const current = variantIds.length ? await ctx.db.query.variants.findMany({ where: inArray(schema.variants.id, variantIds) }) : [];
  const productIds = [...new Set(current.map((v) => v.productId))];
  const [products, siblings] = productIds.length
    ? await Promise.all([
        ctx.db.query.products.findMany({ where: inArray(schema.products.id, productIds) }),
        ctx.db.query.variants.findMany({ where: inArray(schema.variants.productId, productIds), orderBy: schema.variants.position }),
      ])
    : [[], []];
  return {
    canEdit: !reason,
    reason,
    until: by === "buyer" ? buyerDeadline(order) : null,
    address: order.shippingAddress,
    lines: lines.map((l) => {
      const v = current.find((x) => x.id === l.variantId);
      const product = v && products.find((p) => p.id === v.productId);
      // Same item, same price, in stock for this many. Gift cards are amounts, not sizes.
      const choices =
        v && product && !product.giftCard
          ? siblings
              .filter((s) => s.productId === v.productId && s.priceMinor === v.priceMinor && (s.id === v.id || s.stock === null || s.stock >= l.quantity))
              .map((s) => ({ variantId: s.id, title: s.title === "Default" ? product.title : s.title }))
          : [];
      return { id: l.id, title: l.title, quantity: l.quantity, variantId: l.variantId, choices: choices.length > 1 ? choices : [] };
    }),
  };
}

const sameAddress = (a: Address, b: Address) =>
  (["name", "line1", "line2", "city", "region", "postalCode", "country", "phone"] as const).every((k) => (a[k] ?? "") === (b[k] ?? ""));

/**
 * Changes the delivery address and/or swaps lines to another variant of the same product at the
 * same price. Supplier orders affected are cancelled first; if a supplier won't cancel (it's
 * already packing), nothing changes. Then they're placed again and the buyer is emailed.
 */
export async function editOrder(
  ctx: FulfillmentContext,
  shopId: string,
  orderId: string,
  input: { address?: Partial<Address>; lines?: Record<string, string> },
  by: Who,
) {
  const { db } = ctx;
  const now = ctx.now?.() ?? new Date();
  const { order, lines, fulfillments } = await load(ctx, shopId, orderId);
  const reason = blocked(order, fulfillments, by, now);
  if (reason) throw new UserError(reason);
  const options = await orderEditOptions(ctx, shopId, orderId, by);

  const changes: string[] = [];
  let address: Address | null = null;
  if (input.address) {
    // A form without a phone field keeps the number the order has.
    const parsed = addressSchema.safeParse({ ...input.address, country: input.address.country ?? order.shippingAddress.country, phone: input.address.phone ?? order.shippingAddress.phone });
    if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
    const next = { ...parsed.data, line2: parsed.data.line2 || undefined, region: parsed.data.region || undefined };
    // Shipping and tax were worked out for this country.
    if (next.country !== order.shippingAddress.country) {
      throw new UserError(`It can only go to another address in ${countryName(order.shippingAddress.country)}. For another country, cancel this order and place a new one.`);
    }
    if (!sameAddress(next, order.shippingAddress)) {
      address = next;
      changes.push(`New delivery address: ${[next.line1, next.line2, next.city, next.postalCode].filter(Boolean).join(", ")}`);
    }
  }

  const swaps: { lineId: string; variantId: string; title: string; unitCostMinor: number | null; supplierId: string | null; was: string }[] = [];
  for (const [lineId, variantId] of Object.entries(input.lines ?? {})) {
    const line = lines.find((l) => l.id === lineId);
    const opts = options.lines.find((l) => l.id === lineId);
    if (!line || !opts) throw new UserError("That item isn't on this order.");
    if (!variantId || variantId === line.variantId) continue;
    if (!opts.choices.some((c) => c.variantId === variantId)) throw new UserError(`That option of ${line.title} isn't available at the same price any more.`);
    const v = (await db.query.variants.findFirst({ where: eq(schema.variants.id, variantId) }))!;
    const product = (await db.query.products.findFirst({ where: eq(schema.products.id, v.productId) }))!;
    const title = variantLabel(product.title, v.title);
    swaps.push({ lineId, variantId, title, unitCostMinor: v.costMinor, supplierId: product.supplierId, was: line.title });
    changes.push(`${line.title} is now ${title}`);
  }
  if (!changes.length) throw new UserError("Nothing changed.");

  // Which supplier orders need redoing: all of them for a new address, else the swapped items' ones.
  const oldSuppliers = swaps.length
    ? (
        await db
          .select({ supplierId: schema.products.supplierId })
          .from(schema.variants)
          .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
          .where(inArray(schema.variants.id, swaps.map((s) => lines.find((l) => l.id === s.lineId)!.variantId!)))
      ).map((r) => r.supplierId)
    : [];
  const mains = [...new Set([...oldSuppliers, ...swaps.map((s) => s.supplierId)].filter((x): x is string => !!x))];
  // Items a backup supplier took instead of their main one are redone there.
  const standIns = mains.length
    ? (await db.query.fulfillments.findMany({ where: and(eq(schema.fulfillments.orderId, order.id), inArray(schema.fulfillments.backupForSupplierId, mains)) })).map((f) => f.supplierId!)
    : [];
  const affected = address ? undefined : [...new Set([...mains, ...standIns])];
  const cancel = affected && !affected.length ? { cancelled: 0, notCancelled: [], cancelledIds: [] as string[] } : await cancelUnshipped(ctx, order.id, affected);
  if (cancel.notCancelled.length) {
    // Leave the order as it was: put back what we stopped.
    await reopen(ctx, cancel.cancelledIds, order.id);
    const first = cancel.notCancelled[0]!;
    throw new UserError(
      by === "buyer"
        ? "It's already being packed, so it can't be changed online. Message the store below and they'll see what they can do."
        : `${first.supplier} couldn't cancel the order to change it: ${first.message}`,
      "too_late",
    );
  }

  const edit: OrderEdit = { at: now.toISOString(), by, changes };
  let risk: Pick<Order, "risk" | "heldAt"> | null = null;
  await db.transaction(async (tx) => {
    for (const s of swaps) {
      await tx.update(schema.orderLines).set({ variantId: s.variantId, title: s.title, unitCostMinor: s.unitCostMinor }).where(eq(schema.orderLines.id, s.lineId));
      const line = lines.find((l) => l.id === s.lineId)!;
      await moveLineStock(tx as unknown as Db, order, line, line.variantId, s.variantId);
    }
    await tx
      .update(schema.orders)
      .set({ ...(address ? { shippingAddress: address } : {}), edits: [...order.edits, edit], updatedAt: now })
      .where(eq(schema.orders.id, order.id));
  });
  // A buyer sending it somewhere new is checked again, unless the merchant already looked at it.
  if (address && by === "buyer" && !order.riskReviewedAt && !order.heldAt) {
    const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
    const assessed = await assessOrderRisk(db, order.id, now);
    risk = { risk: assessed, heldAt: shouldHold(shop?.holdRiskyOrders ?? "high", assessed.level) ? now : null };
    await db.update(schema.orders).set(risk).where(eq(schema.orders.id, order.id));
  }
  await reopen(ctx, cancel.cancelledIds, order.id);
  const email = await sendOrderEmail(ctx, order.id, "order_updated", String(order.edits.length));
  return { changes, held: !!(risk?.heldAt ?? order.heldAt), resent: cancel.cancelledIds.length > 0, email: email.status };
}

/** Puts cancelled supplier orders back in line and sends them (unless the order is on hold). */
async function reopen(ctx: FulfillmentContext, fulfillmentIds: string[], orderId: string) {
  if (!fulfillmentIds.length) return;
  await ctx.db
    .update(schema.fulfillments)
    .set({ status: "pending", supplierOrderRef: null, placedAt: null, problemCode: null, problemMessage: null, attempts: 0, updatedAt: ctx.now?.() ?? new Date() })
    .where(and(inArray(schema.fulfillments.id, fulfillmentIds), eq(schema.fulfillments.status, "cancelled")));
  await routeOrder(ctx, orderId);
  await refreshOrderFulfillment(ctx.db, orderId, ctx.now?.() ?? new Date());
}

/** Whether the buyer can cancel this order from its page right now, and until when. */
export async function buyerCancelOptions(ctx: Pick<FulfillmentContext, "db" | "now">, shopId: string, orderId: string) {
  const { order, fulfillments } = await load(ctx, shopId, orderId);
  const shop = await ctx.db.query.shops.findFirst({ where: eq(schema.shops.id, shopId), columns: { buyerCancel: true } });
  const reason = !shop?.buyerCancel || !order.paymentIntentId || order.totalMinor <= 0 || order.source === "replacement" ? "off" : blocked(order, fulfillments, "buyer", ctx.now?.() ?? new Date());
  return { canCancel: !reason, until: buyerDeadline(order) };
}

/**
 * The buyer cancels their own order before it ships, in the first hours after paying: supplier
 * orders are stopped, then the whole order is refunded. If a supplier won't stop theirs (it's
 * already packing), nothing changes and the buyer is told to message the store. The people who
 * handle orders are emailed either way it ends.
 */
export async function cancelOrderByBuyer(ctx: RefundContext & { adminUrl: (path: string) => string }, shopId: string, orderId: string, input: { reason?: string } = {}) {
  const { db } = ctx;
  const now = ctx.now?.() ?? new Date();
  const { canCancel } = await buyerCancelOptions(ctx, shopId, orderId);
  if (!canCancel) throw new UserError("This order can't be cancelled online any more. Message the store below and they'll see what they can do.", "too_late");
  const { order } = await load(ctx, shopId, orderId);
  const why = input.reason?.trim().slice(0, 300) || null;
  const cancel = await cancelUnshipped(ctx, order.id);
  if (cancel.notCancelled.length) {
    await reopen(ctx, cancel.cancelledIds, order.id);
    throw new UserError("It's already being packed, so it can't be cancelled online. Message the store below and they'll see what they can do.", "too_late");
  }
  const edit: OrderEdit = { at: now.toISOString(), by: "buyer", changes: [why ? `Cancelled: ${why}` : "Cancelled"] };
  await db.update(schema.orders).set({ edits: [...order.edits, edit], updatedAt: now }).where(eq(schema.orders.id, order.id));

  const shop = (await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) }))!;
  const tell = async (subject: string, lines: string[]) => {
    const people = await db
      .select({ email: schema.users.email, role: schema.shopMembers.role })
      .from(schema.shopMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.shopMembers.userId))
      .where(eq(schema.shopMembers.shopId, shopId));
    for (const p of people.filter((x) => can(x.role, "orders"))) {
      await ctx.mailer.send({ to: p.email, subject, text: ["Hi,", "", ...lines, "", ctx.adminUrl(`/admin/orders/${order.id}`)].join("\n") });
    }
  };
  const said = why ? ` They said: "${why}"` : "";
  try {
    const result = await refundOrder(ctx, shopId, order.id, { reason: why ? `Cancelled by the buyer: ${why}` : "Cancelled by the buyer" });
    await tell(`Order #${order.number} at ${shop.name} was cancelled by the buyer`, [
      `The buyer cancelled order #${order.number} from its page before it shipped.${said}`,
      ``,
      `Supplier orders were stopped and the buyer was refunded in full. There's nothing for you to do.`,
    ]);
    return result;
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    await tell(`Refund needed: order #${order.number} at ${shop.name} was cancelled`, [
      `The buyer cancelled order #${order.number} before it shipped, and the supplier orders were stopped, but the refund didn't go through: ${e.message}${said}`,
      ``,
      `Refund it from the order page:`,
    ]);
    throw new UserError("Your order is cancelled, but the refund didn't go through right away. The store has been told and will refund you.", "refund_failed");
  }
}

/** Turns buyers cancelling their own orders on or off for a store. */
export async function setBuyerCancel(db: FulfillmentContext["db"], shopId: string, on: boolean) {
  await db.update(schema.shops).set({ buyerCancel: on, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
}
