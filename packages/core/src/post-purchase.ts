// The after-checkout offer: right after paying, the buyer's order page offers one product at a
// discount, added with one click to the card they just used. It becomes its own order, linked to
// the first, so payment, invoice, supplier and refunds work as for any order.
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { handlePaymentEvent, quoteCart, startCheckout } from "./orders";
import type { PaymentProvider } from "./payments";
import { BuiltInTaxCalculator, listTaxRegistrations, type TaxCalculator } from "./tax";
import { percentOff } from "./wholesale";

type Shop = typeof schema.shops.$inferSelect;
type Order = typeof schema.orders.$inferSelect;

/** How long after paying the offer stays on the order page. */
export const POST_PURCHASE_MINUTES = 15;

const offerInput = z.object({
  productId: z.string().uuid("Pick a product to offer.").nullable(),
  percentOff: z.number({ error: "Enter the percent off." }).int("Use a whole number.").min(0, "The discount can't be negative.").max(50, "Keep it to 50% off or less."),
  active: z.boolean(),
});

/** Sets or clears the store's after-checkout offer. */
export async function setPostPurchaseOffer(db: Db, shopId: string, input: z.input<typeof offerInput>) {
  const parsed = offerInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { productId, percentOff, active } = parsed.data;
  if (!productId) {
    if (active) throw new UserError("Pick a product to offer.");
    await db.update(schema.shops).set({ postPurchaseOffer: null }).where(eq(schema.shops.id, shopId));
    return null;
  }
  const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)) });
  if (!product) throw new UserError("That product isn't in your store.");
  if (product.giftCard) throw new UserError("Gift cards can't be the after-checkout offer.");
  if (active && product.status !== "active") throw new UserError(`"${product.title}" isn't on sale, so buyers couldn't add it. Publish it first.`);
  const offer = { productId, percentOff, active };
  await db.update(schema.shops).set({ postPurchaseOffer: offer }).where(eq(schema.shops.id, shopId));
  return offer;
}

export type PostPurchaseView = {
  product: { id: string; title: string; handle: string; imageUrl: string | null };
  percentOff: number;
  expiresAt: Date;
  /** What each option costs at full price, with the offer, and what the card is charged (tax included). */
  variants: { id: string; title: string; priceMinor: number; offerMinor: number; chargeMinor: number }[];
};

/**
 * The offer to show on an order's page, or null: the store has one on, the order was just paid by
 * a card kept for it, it doesn't already have the product, and something is in stock.
 */
export async function postPurchaseOfferFor(db: Db, shop: Shop, order: Order, opts: { now?: Date; taxCalculator?: TaxCalculator } = {}): Promise<PostPurchaseView | null> {
  const offer = shop.postPurchaseOffer;
  const now = opts.now ?? new Date();
  if (!offer?.active || !order.cardSaved || order.paymentStatus !== "paid" || !order.paidAt || order.source === "post_purchase") return null;
  const expiresAt = new Date(order.paidAt.getTime() + POST_PURCHASE_MINUTES * 60_000);
  if (now >= expiresAt) return null;
  if (await db.query.orders.findFirst({ where: eq(schema.orders.parentOrderId, order.id), columns: { id: true } })) return null;
  const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, offer.productId), eq(schema.products.shopId, shop.id)) });
  if (!product || product.status !== "active" || product.giftCard) return null;
  const variants = await db.query.variants.findMany({ where: eq(schema.variants.productId, product.id), orderBy: schema.variants.position });
  const bought = await db.query.orderLines.findMany({ where: and(eq(schema.orderLines.orderId, order.id), inArray(schema.orderLines.variantId, variants.map((v) => v.id))) });
  if (bought.length) return null;
  const inStock = variants.filter((v) => v.stock === null || v.stock > 0);
  if (!inStock.length) return null;

  const tax = opts.taxCalculator ?? new BuiltInTaxCalculator();
  const registrations = (await listTaxRegistrations(db, shop.id)).map((r) => r.jurisdiction);
  const priced = [];
  for (const v of inStock) {
    // Priced one at a time, as checkout would charge it (sales included), less the offer.
    const quote = await quoteCart(db, shop, [{ variantId: v.id, quantity: 1 }], { country: order.shippingAddress.country }).catch((e) => {
      if (e instanceof UserError) return null;
      throw e;
    });
    const item = quote?.items[0];
    if (!item) continue;
    const offerMinor = percentOff(item.unitPriceMinor, offer.percentOff);
    const t = await tax.calculate({
      currency: shop.currency,
      lines: [{ reference: v.id, amountMinor: offerMinor }],
      shippingMinor: 0,
      address: order.shippingAddress,
      pricesIncludeTax: shop.pricesIncludeTax,
      accountId: shop.paymentsAccountId,
      registrations,
    });
    priced.push({ id: v.id, title: v.title, priceMinor: item.unitPriceMinor, offerMinor, chargeMinor: offerMinor + (t.included ? 0 : t.taxMinor) });
  }
  if (!priced.length) return null;
  return { product: { id: product.id, title: product.title, handle: product.handle, imageUrl: product.imageUrl }, percentOff: offer.percentOff, expiresAt, variants: priced };
}

/** The order added after checkout to this one, if the buyer took the offer. */
export async function postPurchaseOrder(db: Db, orderId: string) {
  return (await db.query.orders.findFirst({ where: and(eq(schema.orders.parentOrderId, orderId), eq(schema.orders.paymentStatus, "paid")) })) ?? null;
}

/**
 * The buyer took the offer: a new order for one of the product, charged to the card from the order
 * they just paid. A declined card leaves nothing behind. Like any newly paid order, the caller then
 * runs `onOrderPaid` for it (receipt, invoice, supplier).
 */
export async function acceptPostPurchaseOffer(
  ctx: { db: Db; payments: PaymentProvider },
  shop: Shop,
  input: { orderRef: string; variantId: string },
  opts: { now?: Date; taxCalculator?: TaxCalculator } = {},
) {
  const { db } = ctx;
  const parent = await db.query.orders.findFirst({ where: and(eq(schema.orders.shopId, shop.id), eq(schema.orders.paymentIntentId, input.orderRef)) });
  if (!parent) throw new NotFoundError("Order");
  const offer = await postPurchaseOfferFor(db, shop, parent, opts);
  if (!offer) {
    if (await postPurchaseOrder(db, parent.id)) throw new UserError("It's already added to your order.", "already_added");
    throw new UserError("This offer has ended.", "offer_ended");
  }
  if (!offer.variants.some((v) => v.id === input.variantId)) throw new UserError("Pick one of the options shown.");

  let child: Order;
  try {
    ({ order: child } = await startCheckout(
      db,
      ctx.payments,
      shop,
      { email: parent.email, address: parent.shippingAddress, lines: [{ variantId: input.variantId, quantity: 1 }], followUp: { parentOrderId: parent.id, percentOff: offer.percentOff } },
      opts.taxCalculator,
    ));
  } catch (e) {
    // A second click while the first is still charging.
    if (isUniqueViolation(e)) throw new UserError("It's already being added to your order.", "already_added");
    throw e;
  }
  let charged: { id: string };
  try {
    charged = await ctx.payments.chargeSavedCard({
      fromPaymentIntentId: parent.paymentIntentId!,
      amountMinor: child.totalMinor,
      currency: child.currency,
      shopAccountId: shop.paymentsAccountId,
      applicationFeeMinor: child.platformFeeMinor,
      metadata: { shopId: shop.id, parentOrderId: parent.id },
    });
  } catch (e) {
    await db.delete(schema.orders).where(eq(schema.orders.id, child.id));
    throw e;
  }
  await db.update(schema.orders).set({ paymentIntentId: charged.id }).where(eq(schema.orders.id, child.id));
  await handlePaymentEvent(db, ctx.payments.name, { id: `charged_${charged.id}`, type: "payment.succeeded", paymentIntentId: charged.id, amountMinor: child.totalMinor });
  return (await db.query.orders.findFirst({ where: eq(schema.orders.id, child.id) }))!;
}

function isUniqueViolation(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

/** How often buyers took the offer, and what it brought in, for the merchant. */
export async function postPurchaseStats(db: Db, shopId: string) {
  const [row] = await db
    .select({ orders: sql<number>`count(*)`.mapWith(Number), revenueMinor: sql<number>`coalesce(sum(${schema.orders.totalMinor} - ${schema.orders.refundedMinor}), 0)`.mapWith(Number) })
    .from(schema.orders)
    .where(and(eq(schema.orders.shopId, shopId), eq(schema.orders.source, "post_purchase"), inArray(schema.orders.paymentStatus, ["paid", "partially_refunded"])));
  return row ?? { orders: 0, revenueMinor: 0 };
}
