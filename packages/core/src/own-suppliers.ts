// The merchant's own suppliers: any wholesaler, warehouse or maker, reached by email. A paid order's
// items go to them as a purchase order email with a private link, where they add tracking or say
// they can't send it. No supplier account or API is needed on either side.
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { refreshOrderFulfillment, sendOrderEmail, trackingInput, type FulfillmentContext } from "./fulfillment";
import { SupplierError, type ProblemCode, type Suppliers } from "./suppliers";

type SupplierLink = typeof schema.suppliers.$inferSelect;
type Fulfillment = typeof schema.fulfillments.$inferSelect;
type Order = typeof schema.orders.$inferSelect;

const newToken = sql`replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`;

const ownSupplierInput = z.object({
  name: z.string().trim().min(1, "Enter the supplier's name.").max(100, "Keep the name under 100 characters."),
  email: z.string().trim().toLowerCase().email("Enter the email address orders should go to."),
});

const API_LABELS: Record<string, string> = { fake: "Demo supplier", cj: "CJ Dropshipping" };

/** What merchants call a supplier link: the name they gave their own supplier, or the service's name. */
export function supplierLabel(suppliers: Suppliers, link: Pick<SupplierLink, "provider" | "name"> | null | undefined) {
  if (!link) return "Supplier";
  if (link.provider === "email") return link.name ?? "Your supplier";
  return suppliers.available.find((s) => s.name === link.provider)?.label ?? API_LABELS[link.provider] ?? link.provider;
}

function parse(input: z.input<typeof ownSupplierInput>) {
  const parsed = ownSupplierInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  return parsed.data;
}

async function find(db: Db, shopId: string, id: string) {
  const link = await db.query.suppliers.findFirst({
    where: and(eq(schema.suppliers.id, id), eq(schema.suppliers.shopId, shopId), eq(schema.suppliers.provider, "email"), eq(schema.suppliers.status, "connected")),
  });
  if (!link) throw new NotFoundError("Supplier");
  return link;
}

async function emailTaken(db: Db, shopId: string, email: string) {
  return db.query.suppliers.findFirst({
    where: and(eq(schema.suppliers.shopId, shopId), eq(schema.suppliers.provider, "email"), eq(schema.suppliers.contactEmail, email)),
  });
}

export async function addOwnSupplier(db: Db, shopId: string, input: z.input<typeof ownSupplierInput>) {
  const { name, email } = parse(input);
  const existing = await emailTaken(db, shopId, email);
  if (existing?.status === "connected") throw new UserError(`${existing.name} already uses ${email}.`);
  if (existing) {
    // Added again after being removed: same row, so its old orders keep their supplier.
    const [row] = await db.update(schema.suppliers).set({ name, status: "connected" }).where(eq(schema.suppliers.id, existing.id)).returning();
    return row!;
  }
  const [row] = await db.insert(schema.suppliers).values({ shopId, provider: "email", name, contactEmail: email }).returning();
  return row!;
}

export async function updateOwnSupplier(db: Db, shopId: string, id: string, input: z.input<typeof ownSupplierInput>) {
  const link = await find(db, shopId, id);
  const { name, email } = parse(input);
  if (email !== link.contactEmail && (await emailTaken(db, shopId, email))) throw new UserError(`Another supplier uses ${email}.`);
  const [row] = await db.update(schema.suppliers).set({ name, contactEmail: email }).where(eq(schema.suppliers.id, link.id)).returning();
  return row!;
}

export async function getOwnSupplier(db: Db, shopId: string, id: string) {
  return find(db, shopId, id);
}

export async function listOwnSuppliers(db: Db, shopId: string) {
  const rows = await db.query.suppliers.findMany({
    where: and(eq(schema.suppliers.shopId, shopId), eq(schema.suppliers.provider, "email"), eq(schema.suppliers.status, "connected")),
    orderBy: schema.suppliers.name,
  });
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [products, open] = await Promise.all([
    db.select({ id: schema.products.supplierId, n: count() }).from(schema.products).where(inArray(schema.products.supplierId, ids)).groupBy(schema.products.supplierId),
    db
      .select({ id: schema.fulfillments.supplierId, n: count() })
      .from(schema.fulfillments)
      .where(and(inArray(schema.fulfillments.supplierId, ids), eq(schema.fulfillments.status, "placed")))
      .groupBy(schema.fulfillments.supplierId),
  ]);
  return rows.map((r) => ({
    ...r,
    products: Number(products.find((p) => p.id === r.id)?.n ?? 0),
    openOrders: Number(open.find((o) => o.id === r.id)?.n ?? 0),
  }));
}

/** Their products go back to "I ship it myself" and their link stops working. */
export async function removeOwnSupplier(db: Db, shopId: string, id: string) {
  const link = await find(db, shopId, id);
  const [{ n }] = (await db
    .select({ n: count() })
    .from(schema.fulfillments)
    .where(and(eq(schema.fulfillments.supplierId, link.id), eq(schema.fulfillments.status, "placed")))) as [{ n: number }];
  if (n > 0) {
    throw new UserError(`${link.name} still has ${n} order${n === 1 ? "" : "s"} to send. Remove them once those have shipped, or refund those orders first.`);
  }
  await db.transaction(async (tx) => {
    await tx.update(schema.products).set({ supplierId: null, updatedAt: new Date() }).where(eq(schema.products.supplierId, link.id));
    await tx.update(schema.suppliers).set({ status: "disconnected", portalToken: newToken }).where(eq(schema.suppliers.id, link.id));
  });
}

/** For a link that was forwarded to the wrong person: the old one stops working at once. */
export async function resetSupplierLink(db: Db, shopId: string, id: string) {
  const link = await find(db, shopId, id);
  const [row] = await db.update(schema.suppliers).set({ portalToken: newToken }).where(eq(schema.suppliers.id, link.id)).returning();
  return row!;
}

/**
 * Who sends this product: one of the merchant's own suppliers, or null for "I ship it myself".
 * Moving a product away from an API supplier drops its link there, since orders can't go to both.
 */
export async function setProductSupplier(db: Db, shopId: string, productId: string, supplierId: string | null) {
  const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)) });
  if (!product) throw new NotFoundError("Product");
  if (supplierId && product.giftCard) throw new UserError("Gift cards are sent by email, so they don't need a supplier.");
  if (supplierId) await find(db, shopId, supplierId);
  if (product.supplierId === supplierId) return;
  const current = product.supplierId ? await db.query.suppliers.findFirst({ where: eq(schema.suppliers.id, product.supplierId) }) : null;
  await db.transaction(async (tx) => {
    const fromApi = current && current.provider !== "email";
    await tx
      .update(schema.products)
      .set({ supplierId, ...(fromApi ? { supplierProductRef: null } : {}), updatedAt: new Date() })
      .where(eq(schema.products.id, product.id));
    if (fromApi) await tx.update(schema.variants).set({ supplierVariantRef: null }).where(eq(schema.variants.productId, product.id));
  });
}

// Orders ---------------------------------------------------------------------------------------

/** The order's items that this supplier sends. */
async function itemsFor(db: Db, orderId: string, supplierId: string) {
  return db
    .select({ title: schema.orderLines.title, quantity: schema.orderLines.quantity, sku: schema.variants.sku })
    .from(schema.orderLines)
    .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(eq(schema.orderLines.orderId, orderId), eq(schema.products.supplierId, supplierId)));
}

const poRef = (order: Order) => `PO-${order.number}`;

function addressLines(a: Order["shippingAddress"]) {
  return [a.name, a.line1, a.line2, [a.city, a.region, a.postalCode].filter(Boolean).join(" "), a.country].filter(Boolean) as string[];
}

/** Called by routeOrder for an own supplier. The buyer's email address is never shared. */
export async function sendPurchaseOrder(ctx: FulfillmentContext, link: SupplierLink, order: Order) {
  const shop = (await ctx.db.query.shops.findFirst({ where: eq(schema.shops.id, order.shopId) }))!;
  const items = await itemsFor(ctx.db, order.id, link.id);
  const ref = poRef(order);
  const portal = ctx.supplierPortalUrl?.(link.portalToken);
  const text = [
    `Hi ${link.name},`,
    ``,
    `${shop.name} has a new order for you to send.`,
    ``,
    `Order ${ref}`,
    ...items.map((i) => `  ${i.quantity} × ${i.title}${i.sku ? `  (SKU ${i.sku})` : ""}`),
    ``,
    `Ship to:`,
    ...addressLines(order.shippingAddress).map((l) => `  ${l}`),
    ``,
    portal
      ? `When it ships, add the tracking number here (no account needed): ${portal}\nIf you can't send it, say so on the same page and ${shop.name} will sort it out.`
      : `Reply with the tracking number when it ships.`,
  ].join("\n");
  try {
    await ctx.mailer.send({ to: link.contactEmail!, subject: `New order ${ref} from ${shop.name}`, text });
  } catch {
    throw new SupplierError("supplier_unreachable", `The order email to ${link.name} couldn't be sent.`, true);
  }
  return { supplierOrderRef: ref };
}

/** A refund cancels an unshipped purchase order: the supplier is told not to send it. */
export async function cancelPurchaseOrder(ctx: FulfillmentContext, link: SupplierLink, f: Fulfillment) {
  const shop = (await ctx.db.query.shops.findFirst({ where: eq(schema.shops.id, f.shopId) }))!;
  await ctx.mailer.send({
    to: link.contactEmail!,
    subject: `Cancelled: order ${f.supplierOrderRef} from ${shop.name}`,
    text: [`Hi ${link.name},`, ``, `${shop.name} cancelled order ${f.supplierOrderRef}. Please don't send it.`, ``, `If it has already gone out, reply to let them know.`].join("\n"),
  });
}

// The supplier's page -------------------------------------------------------------------------

async function portalLink(db: Db, token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  return (
    (await db.query.suppliers.findFirst({
      where: and(eq(schema.suppliers.portalToken, token), eq(schema.suppliers.provider, "email"), eq(schema.suppliers.status, "connected")),
    })) ?? null
  );
}

/** Everything the supplier's private page shows: orders to send, then the last ones they sent. */
export async function supplierPortal(db: Db, token: string) {
  const link = await portalLink(db, token);
  if (!link) return null;
  const shop = (await db.query.shops.findFirst({ where: eq(schema.shops.id, link.shopId), columns: { name: true } }))!;
  const rows = await db
    .select({ f: schema.fulfillments, order: schema.orders })
    .from(schema.fulfillments)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.fulfillments.orderId))
    .where(and(eq(schema.fulfillments.supplierId, link.id), inArray(schema.fulfillments.status, ["placed", "shipped", "delivered"])))
    .orderBy(desc(schema.fulfillments.placedAt))
    .limit(100);
  const orders = await Promise.all(
    rows.map(async ({ f, order }) => ({
      id: f.id,
      ref: f.supplierOrderRef ?? poRef(order),
      status: f.status,
      placedAt: f.placedAt,
      shippedAt: f.shippedAt,
      carrier: f.carrier,
      trackingNumber: f.trackingNumber,
      shipTo: addressLines(order.shippingAddress),
      items: await itemsFor(db, order.id, link.id),
    })),
  );
  return {
    supplier: { name: link.name! },
    shop,
    toSend: orders.filter((o) => o.status === "placed").reverse(),
    sent: orders.filter((o) => o.status !== "placed").slice(0, 20),
  };
}

async function openForSupplier(db: Db, token: string, fulfillmentId: string) {
  const link = await portalLink(db, token);
  if (!link) throw new NotFoundError("Supplier link");
  const f = /^[0-9a-f-]{36}$/i.test(fulfillmentId)
    ? await db.query.fulfillments.findFirst({ where: and(eq(schema.fulfillments.id, fulfillmentId), eq(schema.fulfillments.supplierId, link.id)) })
    : undefined;
  if (!f) throw new NotFoundError("Order");
  if (f.status === "shipped" || f.status === "delivered") throw new UserError("This order is already marked as shipped.");
  if (f.status === "cancelled") throw new UserError("The store cancelled this order. Please don't send it.");
  if (f.status !== "placed") throw new UserError("You already told the store you can't send this one.");
  return { link, f };
}

/** The supplier added tracking: the order shows as shipped and the buyer gets the shipping email. */
export async function supplierMarkShipped(ctx: FulfillmentContext, token: string, fulfillmentId: string, input: z.input<typeof trackingInput>) {
  const parsed = trackingInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { f } = await openForSupplier(ctx.db, token, fulfillmentId);
  const t = ctx.now?.() ?? new Date();
  const [updated] = await ctx.db
    .update(schema.fulfillments)
    .set({
      status: "shipped",
      carrier: parsed.data.carrier,
      trackingNumber: parsed.data.trackingNumber,
      trackingUrl: parsed.data.url || null,
      shippedAt: t,
      problemCode: null,
      problemMessage: null,
      updatedAt: t,
    })
    .where(and(eq(schema.fulfillments.id, f.id), eq(schema.fulfillments.status, "placed")))
    .returning({ id: schema.fulfillments.id });
  if (!updated) throw new UserError("This order changed while you were looking at it. Reload the page.");
  await refreshOrderFulfillment(ctx.db, f.orderId, t);
  await sendOrderEmail(ctx, f.orderId, "shipping_update");
}

export const CANT_SEND_REASONS = {
  out_of_stock: "Out of stock",
  address_unsupported: "Can't ship to this address",
  unknown: "Something else",
} as const satisfies Partial<Record<ProblemCode, string>>;

const cantSendInput = z.object({
  reason: z.enum(Object.keys(CANT_SEND_REASONS) as [keyof typeof CANT_SEND_REASONS, ...(keyof typeof CANT_SEND_REASONS)[]], { message: "Pick a reason." }),
  note: z.string().trim().max(500, "Keep the note under 500 characters.").optional(),
});

/** The supplier can't send it: the order becomes a problem order the merchant sees and fixes. */
export async function supplierCantSend(ctx: FulfillmentContext, token: string, fulfillmentId: string, input: z.input<typeof cantSendInput>) {
  const parsed = cantSendInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { link, f } = await openForSupplier(ctx.db, token, fulfillmentId);
  const { reason, note } = parsed.data;
  const t = ctx.now?.() ?? new Date();
  await ctx.db
    .update(schema.fulfillments)
    .set({ status: "failed", problemCode: reason, problemMessage: `${link.name} can't send it: ${CANT_SEND_REASONS[reason].toLowerCase()}.${note ? ` They said: "${note}"` : ""}`, updatedAt: t })
    .where(and(eq(schema.fulfillments.id, f.id), eq(schema.fulfillments.status, "placed")));
  await refreshOrderFulfillment(ctx.db, f.orderId, t);
}
