// Customer profiles for the merchant: one page per buyer with their orders, spend, addresses, store
// credit and returns, plus the merchant's own note and tags. Also answers privacy requests: a copy
// of everything the store holds about a buyer, and erasing it on request.
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { schema, type Address, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";

const PLACED = ["paid", "partially_refunded", "refunded"] as const;
export const MAX_TAGS = 10;
const TAG_LENGTH = 30;
/** Orders still on their way. A buyer with one of these can't be erased yet. */
const UNFINISHED = ["unfulfilled", "sent_to_supplier", "partially_shipped", "problem"] as const;

/** "VIP, wholesale lead ,vip" → ["vip", "wholesale lead"]. */
export function normalizeTags(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : input.split(",");
  const tags = [...new Set(raw.map((t) => t.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean))];
  const long = tags.find((t) => t.length > TAG_LENGTH);
  if (long) throw new UserError(`Keep each tag to ${TAG_LENGTH} characters ("${long.slice(0, 20)}…" is longer).`);
  if (tags.length > MAX_TAGS) throw new UserError(`A customer can have up to ${MAX_TAGS} tags.`);
  return tags;
}

async function findCustomer(db: Db, shopId: string, customerId: string) {
  if (!z.string().uuid().safeParse(customerId).success) throw new NotFoundError("Customer");
  const customer = await db.query.customers.findFirst({ where: and(eq(schema.customers.id, customerId), eq(schema.customers.shopId, shopId)) });
  if (!customer) throw new NotFoundError("Customer");
  return customer;
}

const ordersOf = (db: Db, shopId: string, email: string) =>
  db.query.orders.findMany({ where: and(eq(schema.orders.shopId, shopId), eq(schema.orders.email, email)), orderBy: desc(schema.orders.createdAt) });

const addressKey = (a: Address) => [a.name, a.line1, a.line2 ?? "", a.city, a.postalCode, a.country].join("|").toLowerCase();

export async function getCustomerProfile(db: Db, shopId: string, customerId: string) {
  const customer = await findCustomer(db, shopId, customerId);
  const all = await ordersOf(db, shopId, customer.email);
  const placed = all.filter((o) => (PLACED as readonly string[]).includes(o.paymentStatus));
  const ids = placed.map((o) => o.id);
  const lines = ids.length ? await db.query.orderLines.findMany({ where: inArray(schema.orderLines.orderId, ids) }) : [];
  const spentMinor = placed.reduce((s, o) => s + o.totalMinor - o.refundedMinor, 0);
  const refundedMinor = placed.reduce((s, o) => s + o.refundedMinor, 0);

  const seen = new Set<string>();
  const addresses: Address[] = [];
  for (const o of placed) {
    const key = addressKey(o.shippingAddress);
    if (!seen.has(key)) {
      seen.add(key);
      addresses.push(o.shippingAddress);
    }
  }
  const giftCards = await db.query.giftCards.findMany({
    where: and(eq(schema.giftCards.shopId, shopId), eq(schema.giftCards.email, customer.email)),
    orderBy: desc(schema.giftCards.createdAt),
    columns: { id: true, last4: true, balanceMinor: true, initialMinor: true, currency: true, disabledAt: true, sourceOrderId: true, createdAt: true },
  });
  const returns = ids.length
    ? await db.query.returnRequests.findMany({ where: inArray(schema.returnRequests.orderId, ids), orderBy: desc(schema.returnRequests.createdAt), columns: { id: true, orderId: true, status: true, reason: true, createdAt: true } })
    : [];
  const byOrder = new Map(placed.map((o) => [o.id, o.number]));

  return {
    customer,
    orders: placed.map((o) => ({
      id: o.id,
      number: o.number,
      paidAt: o.paidAt,
      totalMinor: o.totalMinor,
      refundedMinor: o.refundedMinor,
      currency: o.currency,
      paymentStatus: o.paymentStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      items: lines.filter((l) => l.orderId === o.id).reduce((n, l) => n + l.quantity, 0),
    })),
    /** Checkouts they started and didn't pay for. */
    unpaidCheckouts: all.filter((o) => o.paymentStatus === "pending").length,
    stats: {
      orders: placed.length,
      spentMinor,
      refundedMinor,
      averageMinor: placed.length ? Math.round(spentMinor / placed.length) : 0,
      firstOrderAt: placed.at(-1)?.paidAt ?? null,
      lastOrderAt: placed[0]?.paidAt ?? null,
    },
    addresses,
    storeCreditMinor: giftCards.filter((g) => !g.disabledAt).reduce((s, g) => s + g.balanceMinor, 0),
    giftCards,
    returns: returns.map((r) => ({ ...r, orderNumber: byOrder.get(r.orderId)! })),
  };
}

const notesInput = z.object({
  note: z.string().max(2000, "Keep the note under 2,000 characters.").optional(),
  tags: z.union([z.string().max(500), z.array(z.string())]).optional(),
});

export async function updateCustomerNotes(db: Db, shopId: string, customerId: string, input: z.input<typeof notesInput>) {
  const parsed = notesInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const customer = await findCustomer(db, shopId, customerId);
  const note = parsed.data.note === undefined ? customer.note : parsed.data.note.trim() || null;
  const tags = parsed.data.tags === undefined ? customer.tags : normalizeTags(parsed.data.tags);
  const [row] = await db.update(schema.customers).set({ note, tags }).where(eq(schema.customers.id, customer.id)).returning();
  return row!;
}

/** Every tag the store uses, most used first, to filter the customer list. */
export async function customerTags(db: Db, shopId: string) {
  const rows = await db
    .select({ tags: schema.customers.tags })
    .from(schema.customers)
    .where(and(eq(schema.customers.shopId, shopId), sql`jsonb_array_length(${schema.customers.tags}) > 0`));
  const counts = new Map<string, number>();
  for (const r of rows) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, 50);
}

/* Privacy requests */

/**
 * Everything the store holds about one buyer, for a "send me my data" request. Ids and amounts are
 * kept as stored (minor units) so the file can also be read back by a program.
 */
export async function exportCustomerData(db: Db, shop: { id: string; name: string }, customerId: string, now = new Date()) {
  const customer = await findCustomer(db, shop.id, customerId);
  const orders = await ordersOf(db, shop.id, customer.email);
  const ids = orders.map((o) => o.id);
  const [lines, refunds, reviews, returns] = ids.length
    ? await Promise.all([
        db.query.orderLines.findMany({ where: inArray(schema.orderLines.orderId, ids) }),
        db.query.refunds.findMany({ where: inArray(schema.refunds.orderId, ids) }),
        db.query.reviews.findMany({ where: inArray(schema.reviews.orderId, ids) }),
        db.query.returnRequests.findMany({ where: inArray(schema.returnRequests.orderId, ids) }),
      ])
    : [[], [], [], []];
  const conversations = await db.query.conversations.findMany({
    where: and(eq(schema.conversations.shopId, shop.id), eq(schema.conversations.kind, "buyer"), ids.length ? or(eq(schema.conversations.email, customer.email), inArray(schema.conversations.orderId, ids)) : eq(schema.conversations.email, customer.email)),
  });
  const messages = conversations.length
    ? await db.query.messages.findMany({ where: and(inArray(schema.messages.conversationId, conversations.map((c) => c.id)), eq(schema.messages.status, "sent")), orderBy: schema.messages.createdAt })
    : [];
  const emails = await db.query.emails.findMany({ where: and(eq(schema.emails.shopId, shop.id), eq(schema.emails.to, customer.email)), orderBy: schema.emails.createdAt });
  const giftCards = await db.query.giftCards.findMany({ where: and(eq(schema.giftCards.shopId, shop.id), eq(schema.giftCards.email, customer.email)) });
  const alerts = await db
    .select({ product: schema.products.title, option: schema.variants.title, notifiedAt: schema.stockAlerts.notifiedAt, createdAt: schema.stockAlerts.createdAt })
    .from(schema.stockAlerts)
    .innerJoin(schema.variants, eq(schema.variants.id, schema.stockAlerts.variantId))
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(eq(schema.stockAlerts.shopId, shop.id), eq(schema.stockAlerts.email, customer.email)));
  const saved = await db
    .select({ product: schema.products.title, priceMinor: schema.savedItems.priceMinor, createdAt: schema.savedItems.createdAt })
    .from(schema.savedItems)
    .innerJoin(schema.products, eq(schema.products.id, schema.savedItems.productId))
    .where(eq(schema.savedItems.customerId, customer.id));
  const points = await db.query.rewardEntries.findMany({ where: eq(schema.rewardEntries.customerId, customer.id), orderBy: asc(schema.rewardEntries.createdAt) });
  const numbers = new Map(orders.map((o) => [o.id, o.number]));

  return {
    exported_at: now.toISOString(),
    store: shop.name,
    customer: {
      email: customer.email,
      name: customer.name,
      created_at: customer.createdAt.toISOString(),
      last_sign_in_at: customer.lastSignInAt?.toISOString() ?? null,
      accepts_marketing: customer.acceptsMarketing,
      price_drop_emails: customer.priceAlerts,
      marketing_consent_at: customer.marketingConsentAt?.toISOString() ?? null,
      unsubscribed_at: customer.unsubscribedAt?.toISOString() ?? null,
      wholesale: customer.wholesaleStatus === "none" ? null : { status: customer.wholesaleStatus, company: customer.wholesaleCompany, tax_id: customer.wholesaleTaxId, message: customer.wholesaleMessage },
      merchant_note: customer.note,
      tags: customer.tags,
    },
    orders: orders.map((o) => ({
      number: o.number,
      created_at: o.createdAt.toISOString(),
      paid_at: o.paidAt?.toISOString() ?? null,
      payment_status: o.paymentStatus,
      fulfillment_status: o.fulfillmentStatus,
      email: o.email,
      shipping_address: o.shippingAddress,
      currency: o.currency,
      subtotal: o.subtotalMinor,
      discount: o.discountMinor,
      shipping: o.shippingMinor,
      tax: o.taxMinor,
      total: o.totalMinor,
      refunded: o.refundedMinor,
      items: lines.filter((l) => l.orderId === o.id).map((l) => ({ title: l.title, quantity: l.quantity, unit_price: l.unitPriceMinor })),
      refunds: refunds.filter((r) => r.orderId === o.id).map((r) => ({ amount: r.amountMinor, reason: r.reason, created_at: r.createdAt.toISOString() })),
    })),
    reviews: reviews.map((r) => ({ order: numbers.get(r.orderId), name: r.name, rating: r.rating, body: r.body, status: r.status, created_at: r.createdAt.toISOString() })),
    returns: returns.map((r) => ({ order: numbers.get(r.orderId), status: r.status, reason: r.reason, note: r.note, items: r.items.map((i) => ({ title: i.title, quantity: i.quantity })), created_at: r.createdAt.toISOString() })),
    messages: messages.map((m) => ({ conversation: conversations.find((c) => c.id === m.conversationId)!.subject, from: m.author === "buyer" ? "you" : "store", body: m.body, at: m.createdAt.toISOString() })),
    emails_sent: emails.map((e) => ({ subject: e.subject, kind: e.kind, status: e.status, at: (e.sentAt ?? e.createdAt).toISOString() })),
    back_in_stock_requests: alerts.map((a) => ({ product: a.product, option: a.option, asked_at: a.createdAt.toISOString(), emailed_at: a.notifiedAt?.toISOString() ?? null })),
    saved_items: saved.map((x) => ({ product: x.product, price_when_saved: x.priceMinor, saved_at: x.createdAt.toISOString() })),
    reward_points: points.map((x) => ({ points: x.points, kind: x.kind, note: x.note, at: x.createdAt.toISOString() })),
    gift_cards: giftCards.map((g) => ({ ending: g.last4, currency: g.currency, initial: g.initialMinor, balance: g.balanceMinor, created_at: g.createdAt.toISOString() })),
  };
}

export const erasedEmail = (customerId: string) => `erased-${customerId.slice(0, 8)}@erased.invalid`;

/**
 * Erases a buyer on request. Orders stay for the store's accounts and tax records, but lose the
 * email, name and street address (the country, region and postcode stay, since tax depends on
 * them). Their messages, emails, sign-in codes, back-in-stock requests and campaign history are deleted, reviews show as
 * "Verified buyer", and the customer record goes. Refused while an order is still on its way or a
 * return is open, since the store still needs the details to finish it.
 */
export async function eraseCustomer(db: Db, shopId: string, customerId: string, input: { confirmEmail: string }) {
  const customer = await findCustomer(db, shopId, customerId);
  if (input.confirmEmail.trim().toLowerCase() !== customer.email.toLowerCase()) {
    throw new UserError("Type the customer's email exactly to confirm.", "confirm");
  }
  const orders = await ordersOf(db, shopId, customer.email);
  const open = orders.find((o) => (PLACED as readonly string[]).includes(o.paymentStatus) && o.paymentStatus !== "refunded" && (UNFINISHED as readonly string[]).includes(o.fulfillmentStatus));
  if (open) throw new UserError(`Order #${open.number} hasn't reached them yet. Finish or refund it first, then erase their data.`, "open_order");
  const ids = orders.map((o) => o.id);
  if (ids.length) {
    const openReturn = await db.query.returnRequests.findFirst({ where: and(inArray(schema.returnRequests.orderId, ids), inArray(schema.returnRequests.status, ["requested", "approved"])) });
    if (openReturn) throw new UserError(`They have a return waiting on order #${orders.find((o) => o.id === openReturn.orderId)!.number}. Resolve it first.`, "open_return");
  }

  const email = customer.email;
  const replacement = erasedEmail(customer.id);
  await db.transaction(async (tx) => {
    for (const o of orders) {
      const a = o.shippingAddress;
      await tx
        .update(schema.orders)
        .set({
          email: replacement,
          customerId: null,
          note: null,
          shippingAddress: { name: "Erased", line1: "Erased", city: "Erased", postalCode: a.postalCode, country: a.country, ...(a.region ? { region: a.region } : {}) },
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, o.id));
    }
    const buyerConvos = and(
      eq(schema.conversations.shopId, shopId),
      eq(schema.conversations.kind, "buyer"),
      ids.length ? or(eq(schema.conversations.email, email), inArray(schema.conversations.orderId, ids)) : eq(schema.conversations.email, email),
    );
    await tx.delete(schema.conversations).where(buyerConvos);
    await tx.delete(schema.emails).where(and(eq(schema.emails.shopId, shopId), ids.length ? or(eq(schema.emails.to, email), inArray(schema.emails.orderId, ids)) : eq(schema.emails.to, email)));
    if (ids.length) {
      await tx.update(schema.reviews).set({ name: "Verified buyer" }).where(inArray(schema.reviews.orderId, ids));
      await tx.update(schema.returnRequests).set({ note: null }).where(inArray(schema.returnRequests.orderId, ids));
    }
    await tx.update(schema.giftCards).set({ email: replacement }).where(and(eq(schema.giftCards.shopId, shopId), eq(schema.giftCards.email, email)));
    await tx.delete(schema.campaignSends).where(
      and(eq(schema.campaignSends.email, email), inArray(schema.campaignSends.campaignId, tx.select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.shopId, shopId)))),
    );
    await tx.delete(schema.buyerCodes).where(and(eq(schema.buyerCodes.shopId, shopId), eq(schema.buyerCodes.email, email)));
    await tx.delete(schema.stockAlerts).where(and(eq(schema.stockAlerts.shopId, shopId), eq(schema.stockAlerts.email, email)));
    // Copies of the email in notification and webhook logs and AI notes.
    await tx.execute(sql`update ${schema.pushMessages} set body = replace(body, ${email}, ${replacement}) where shop_id = ${shopId} and position(${email} in body) > 0`);
    await tx.execute(sql`update ${schema.webhookDeliveries} set payload = replace(payload::text, ${email}, ${replacement})::jsonb where shop_id = ${shopId} and position(${email} in payload::text) > 0`);
    await tx.execute(
      sql`update ${schema.agentActions} set summary = replace(summary, ${email}, ${replacement}), input = replace(input::text, ${email}, ${replacement})::jsonb
          where shop_id = ${shopId} and (position(${email} in summary) > 0 or position(${email} in input::text) > 0)`,
    );
    await tx.delete(schema.customers).where(eq(schema.customers.id, customer.id));
  });
  return { orders: ids.length };
}
