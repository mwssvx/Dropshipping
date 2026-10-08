import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Address, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import type { PaymentEvent, PaymentProvider } from "./payments";

type Shop = typeof schema.shops.$inferSelect;
export type CartLine = { variantId: string; quantity: number };

// Milestone 1 shipping rule until shipping zones arrive (M3): free over 50.00, else 4.99.
export const FREE_SHIPPING_OVER_MINOR = 5000;
export const FLAT_SHIPPING_MINOR = 499;

/** Price a cart from the database. Never trusts prices sent by the browser. */
export async function quoteCart(db: Db, shop: Shop, lines: CartLine[]) {
  const wanted = lines.filter((l) => l.quantity > 0);
  if (!wanted.length) throw new UserError("Your cart is empty.");
  const rows = await db
    .select({ variant: schema.variants, product: schema.products })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(
      and(
        inArray(schema.variants.id, wanted.map((l) => l.variantId)),
        eq(schema.products.shopId, shop.id),
        eq(schema.products.status, "active"),
      ),
    );
  const items = wanted.map((l) => {
    const row = rows.find((r) => r.variant.id === l.variantId);
    if (!row) throw new UserError("An item in your cart is no longer available.", "unavailable");
    if (!Number.isInteger(l.quantity) || l.quantity > 99) throw new UserError("Quantity must be between 1 and 99.");
    const title = row.variant.title === "Default" ? row.product.title : `${row.product.title} – ${row.variant.title}`;
    return {
      variantId: row.variant.id,
      productHandle: row.product.handle,
      title,
      imageUrl: row.product.imageUrl,
      quantity: l.quantity,
      unitPriceMinor: row.variant.priceMinor,
      unitCostMinor: row.variant.costMinor,
      lineMinor: row.variant.priceMinor * l.quantity,
    };
  });
  const subtotalMinor = items.reduce((s, i) => s + i.lineMinor, 0);
  const shippingMinor = subtotalMinor >= FREE_SHIPPING_OVER_MINOR ? 0 : FLAT_SHIPPING_MINOR;
  const taxMinor = 0; // Stripe Tax replaces this in milestone 4.
  return { items, currency: shop.currency, subtotalMinor, shippingMinor, taxMinor, totalMinor: subtotalMinor + shippingMinor + taxMinor };
}

const addressSchema = z.object({
  name: z.string().trim().min(1, "Enter the name for delivery."),
  line1: z.string().trim().min(1, "Enter the street address."),
  line2: z.string().trim().optional(),
  city: z.string().trim().min(1, "Enter the city."),
  region: z.string().trim().optional(),
  postalCode: z.string().trim().min(2, "Enter the postal code."),
  country: z.string().trim().length(2, "Choose a country."),
});

const checkoutSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email so we can send your receipt."),
  address: addressSchema,
});

export async function startCheckout(
  db: Db,
  payments: PaymentProvider,
  shop: Shop,
  input: { email: string; address: Address; lines: CartLine[] },
) {
  if (shop.status !== "active") throw new UserError("This store isn't taking orders right now.", "shop_inactive");
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { email, address } = parsed.data;
  const quote = await quoteCart(db, shop, input.lines);

  const intent = await payments.createPaymentIntent({
    amountMinor: quote.totalMinor,
    currency: quote.currency,
    shopAccountId: shop.paymentsAccountId,
    metadata: { shopId: shop.id },
  });

  const order = await db.transaction(async (tx) => {
    const [customer] = await tx
      .insert(schema.customers)
      .values({ shopId: shop.id, email, name: address.name })
      .onConflictDoUpdate({ target: [schema.customers.shopId, schema.customers.email], set: { name: address.name } })
      .returning({ id: schema.customers.id });
    // Lock the shop row so two checkouts can't take the same order number.
    await tx.execute(sql`select 1 from ${schema.shops} where ${schema.shops.id} = ${shop.id} for update`);
    const [{ next }] = (await tx
      .select({ next: sql<number>`coalesce(max(${schema.orders.number}), 1000) + 1` })
      .from(schema.orders)
      .where(eq(schema.orders.shopId, shop.id))) as [{ next: number }];
    const [order] = await tx
      .insert(schema.orders)
      .values({
        shopId: shop.id,
        number: Number(next),
        customerId: customer!.id,
        email,
        shippingAddress: address,
        currency: quote.currency,
        subtotalMinor: quote.subtotalMinor,
        shippingMinor: quote.shippingMinor,
        taxMinor: quote.taxMinor,
        totalMinor: quote.totalMinor,
        paymentIntentId: intent.id,
      })
      .returning();
    await tx.insert(schema.orderLines).values(
      quote.items.map((i) => ({
        orderId: order!.id,
        variantId: i.variantId,
        title: i.title,
        quantity: i.quantity,
        unitPriceMinor: i.unitPriceMinor,
        unitCostMinor: i.unitCostMinor,
      })),
    );
    return order!;
  });

  return { order, clientSecret: intent.clientSecret, quote };
}

/**
 * Apply a payment webhook. Safe to call twice with the same event: the event id is recorded
 * first, and a repeat is ignored.
 */
export async function handlePaymentEvent(db: Db, provider: string, event: PaymentEvent) {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.webhookEvents)
      .values({ id: event.id, provider })
      .onConflictDoNothing()
      .returning({ id: schema.webhookEvents.id });
    if (!inserted.length) return { status: "duplicate" as const };

    const order = await tx.query.orders.findFirst({ where: eq(schema.orders.paymentIntentId, event.paymentIntentId) });
    if (!order) return { status: "unknown_order" as const };

    if (event.type === "payment.succeeded") {
      if (event.amountMinor !== order.totalMinor) throw new Error(`Amount mismatch on order ${order.id}`);
      if (order.paymentStatus === "pending" || order.paymentStatus === "failed") {
        await tx
          .update(schema.orders)
          .set({ paymentStatus: "paid", paidAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.orders.id, order.id));
      }
    } else if (order.paymentStatus === "pending") {
      await tx.update(schema.orders).set({ paymentStatus: "failed", updatedAt: new Date() }).where(eq(schema.orders.id, order.id));
    }
    await tx.update(schema.webhookEvents).set({ processedAt: new Date() }).where(eq(schema.webhookEvents.id, event.id));
    return { status: "processed" as const, orderId: order.id };
  });
}

export async function listOrders(db: Db, shopId: string) {
  return db.query.orders.findMany({ where: eq(schema.orders.shopId, shopId), orderBy: desc(schema.orders.number) });
}

export async function getOrder(db: Db, shopId: string, orderId: string) {
  const order = await db.query.orders.findFirst({
    where: and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId)),
  });
  if (!order) throw new NotFoundError("Order");
  const lines = await db.query.orderLines.findMany({
    where: eq(schema.orderLines.orderId, order.id),
    orderBy: asc(schema.orderLines.title),
  });
  return { ...order, lines };
}

/** For the buyer's order status page. */
export async function getOrderByPaymentIntent(db: Db, shopId: string, paymentIntentId: string) {
  const order = await db.query.orders.findFirst({
    where: and(eq(schema.orders.paymentIntentId, paymentIntentId), eq(schema.orders.shopId, shopId)),
  });
  if (!order) throw new NotFoundError("Order");
  return getOrder(db, shopId, order.id);
}
