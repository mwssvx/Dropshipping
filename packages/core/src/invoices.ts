// Invoices: every paid order gets a numbered invoice, and every refund a credit note, in one
// series per store with no gaps. The seller's details are copied in when a document is issued, so
// later changes never rewrite an old invoice. Amounts are in the currency the buyer paid in.
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { schema, type Db, type InvoiceSeller } from "@sf/db";
import { z } from "zod";
import { buyerAmounts } from "./currency";
import { NotFoundError, UserError } from "./errors";
import { csvCell } from "./payouts";

type Shop = typeof schema.shops.$inferSelect;
type Invoice = typeof schema.invoices.$inferSelect;

const settingsSchema = z.object({
  legalName: z.string().trim().max(120, "Keep the business name under 120 characters."),
  address: z.string().trim().max(400, "Keep the address under 400 characters."),
  prefix: z.string().trim().max(12, "Keep the prefix to 12 characters.").regex(/^[A-Za-z0-9\-/_.]*$/, "The prefix can use letters, numbers, - / _ and ."),
  nextNumber: z.number().int("Enter a whole number.").min(1, "Enter a whole number.").max(99_999_999, "That number is too big."),
  footer: z.string().trim().max(500, "Keep the footer under 500 characters."),
});

const lockShop = (tx: Db, shopId: string) => tx.execute(sql`select 1 from ${schema.shops} where ${schema.shops.id} = ${shopId} for update`);

export async function setInvoiceSettings(db: Db, shopId: string, input: z.input<typeof settingsSchema>) {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { legalName, address, prefix, nextNumber, footer } = parsed.data;
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await lockShop(tx, shopId);
    const shop = await tx.query.shops.findFirst({ where: eq(schema.shops.id, shopId), columns: { invoiceNextNumber: true } });
    if (!shop) throw new NotFoundError("Store");
    // Numbers only go up, so an invoice number is never used twice.
    const next = shop.invoiceNextNumber;
    if (nextNumber < next) throw new UserError(`The next number can't go below ${next}: numbers up to ${next - 1} are already used.`);
    await tx
      .update(schema.shops)
      .set({ invoiceLegalName: legalName || null, invoiceAddress: address || null, invoicePrefix: prefix, invoiceNextNumber: nextNumber, invoiceFooter: footer || null, updatedAt: new Date() })
      .where(eq(schema.shops.id, shopId));
  });
}

/** What an invoice is missing before it would satisfy a tax office. Empty when it's all there. */
export function invoiceGaps(shop: Shop) {
  const gaps: string[] = [];
  if (!shop.invoiceLegalName) gaps.push("your registered business name (the store name is used until then)");
  if (!shop.invoiceAddress && !shop.mailingAddress) gaps.push("your business address");
  return gaps;
}

export const formatInvoiceNumber = (prefix: string, seq: number) => `${prefix}${String(seq).padStart(4, "0")}`;

function taxNumberLabel(jurisdiction: string) {
  if (jurisdiction === "GB") return "UK VAT number";
  if (jurisdiction === "EU") return "EU VAT number (OSS)";
  if (jurisdiction === "CA") return "GST/HST number";
  if (jurisdiction.startsWith("US-")) return `Sales tax permit (${jurisdiction.slice(3)})`;
  return "Tax number";
}

async function sellerFor(db: Db, shop: Shop): Promise<InvoiceSeller> {
  const regs = await db.query.taxRegistrations.findMany({ where: eq(schema.taxRegistrations.shopId, shop.id), orderBy: asc(schema.taxRegistrations.jurisdiction) });
  return {
    name: shop.invoiceLegalName || shop.name,
    address: shop.invoiceAddress || shop.mailingAddress || null,
    taxNumbers: regs.filter((r) => r.registrationNumber).map((r) => ({ label: taxNumberLabel(r.jurisdiction), number: r.registrationNumber! })),
    footer: shop.invoiceFooter,
  };
}

/** Takes the next number in the store's series. Run inside the transaction that uses it. */
async function takeNumber(tx: Db, shopId: string) {
  const [row] = await tx
    .update(schema.shops)
    .set({ invoiceNextNumber: sql`${schema.shops.invoiceNextNumber} + 1` })
    .where(eq(schema.shops.id, shopId))
    .returning({ next: schema.shops.invoiceNextNumber, prefix: schema.shops.invoicePrefix });
  const seq = row!.next - 1;
  return { seq, number: formatInvoiceNumber(row!.prefix, seq) };
}

/** The invoice for a paid order, issued the first time it's asked for. Null until it's paid. */
export async function issueInvoice(db: Db, orderId: string): Promise<Invoice | null> {
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (!order?.paidAt) return null;
  const found = await db.query.invoices.findFirst({ where: and(eq(schema.invoices.orderId, orderId), eq(schema.invoices.kind, "invoice")) });
  if (found) return found;
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await lockShop(tx, order.shopId);
    // Checked again under the lock, so two requests at once can't both take a number.
    const again = await tx.query.invoices.findFirst({ where: and(eq(schema.invoices.orderId, orderId), eq(schema.invoices.kind, "invoice")) });
    if (again) return again;
    const shop = (await tx.query.shops.findFirst({ where: eq(schema.shops.id, order.shopId) }))!;
    const seller = await sellerFor(tx, shop);
    const { seq, number } = await takeNumber(tx, shop.id);
    const [row] = await tx.insert(schema.invoices).values({ shopId: shop.id, orderId, kind: "invoice", number, seq, seller }).returning();
    return row!;
  });
}

/** The credit note for a refund. Issues the order's invoice first if it doesn't have one yet. */
export async function issueCreditNote(db: Db, refundId: string): Promise<Invoice> {
  const refund = await db.query.refunds.findFirst({ where: eq(schema.refunds.id, refundId) });
  if (!refund) throw new NotFoundError("Refund");
  const found = await db.query.invoices.findFirst({ where: eq(schema.invoices.refundId, refundId) });
  if (found) return found;
  await issueInvoice(db, refund.orderId);
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await lockShop(tx, refund.shopId);
    const again = await tx.query.invoices.findFirst({ where: eq(schema.invoices.refundId, refundId) });
    if (again) return again;
    const shop = (await tx.query.shops.findFirst({ where: eq(schema.shops.id, refund.shopId) }))!;
    const seller = await sellerFor(tx, shop);
    const { seq, number } = await takeNumber(tx, shop.id);
    const [row] = await tx.insert(schema.invoices).values({ shopId: shop.id, orderId: refund.orderId, kind: "credit_note", refundId, number, seq, seller }).returning();
    return row!;
  });
}

/**
 * The invoice and credit notes for an order, issuing any that are missing (orders paid or
 * refunded before invoices existed get theirs the first time someone looks).
 */
export async function orderDocuments(db: Db, orderId: string) {
  const invoice = await issueInvoice(db, orderId);
  if (!invoice) return [];
  const refunds = await db.query.refunds.findMany({ where: eq(schema.refunds.orderId, orderId), orderBy: asc(schema.refunds.createdAt) });
  const notes: Invoice[] = [];
  for (const r of refunds) notes.push(await issueCreditNote(db, r.id));
  return [invoice, ...notes].map((d) => ({ id: d.id, kind: d.kind, number: d.number, issuedAt: d.issuedAt }));
}

/** Splits an amount across parts in proportion, so the parts always add up to it. */
function spread(total: number, parts: number[]) {
  const sum = parts.reduce((s, p) => s + p, 0);
  if (!sum) return parts.map((_, i) => (i === parts.length - 1 ? total : 0));
  let left = total;
  return parts.map((p, i) => {
    if (i === parts.length - 1) return left;
    const share = Math.round((total * p) / sum);
    left -= share;
    return share;
  });
}

/** Everything printed on one invoice or credit note. */
export async function invoiceDocument(db: Db, shopId: string, documentId: string) {
  const doc = await db.query.invoices.findFirst({ where: and(eq(schema.invoices.id, documentId), eq(schema.invoices.shopId, shopId)) });
  if (!doc) throw new NotFoundError("Invoice");
  const order = (await db.query.orders.findFirst({ where: eq(schema.orders.id, doc.orderId) }))!;
  const [lines, customer, refunds, invoice] = await Promise.all([
    db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id), orderBy: asc(schema.orderLines.title) }),
    order.customerId ? db.query.customers.findFirst({ where: eq(schema.customers.id, order.customerId) }) : undefined,
    db.query.refunds.findMany({ where: eq(schema.refunds.orderId, order.id) }),
    doc.kind === "credit_note" ? db.query.invoices.findFirst({ where: and(eq(schema.invoices.orderId, order.id), eq(schema.invoices.kind, "invoice")) }) : undefined,
  ]);
  const due = buyerAmounts(order, lines, order.presentment ? refunds.reduce((s, r) => s + (r.presentmentAmountMinor ?? 0), 0) : undefined);
  const taxParts = order.taxBreakdown.length ? spread(due.taxMinor, order.taxBreakdown.map((t) => t.amountMinor)) : [];
  const a = order.shippingAddress;
  const business = order.wholesale && customer?.wholesaleCompany ? { company: customer.wholesaleCompany, taxId: customer.wholesaleTaxId } : null;

  let credit: { invoiceNumber: string | null; amountMinor: number; taxMinor: number; reason: string | null } | null = null;
  if (doc.kind === "credit_note") {
    const refund = refunds.find((r) => r.id === doc.refundId)!;
    const amountMinor = order.presentment && refund.presentmentAmountMinor != null ? refund.presentmentAmountMinor : refund.amountMinor;
    const taxMinor = amountMinor === refund.amountMinor ? refund.taxRefundedMinor : Math.round((refund.taxRefundedMinor * amountMinor) / refund.amountMinor);
    credit = { invoiceNumber: invoice?.number ?? null, amountMinor, taxMinor, reason: refund.reason };
  }

  return {
    id: doc.id,
    kind: doc.kind,
    title: doc.kind === "invoice" ? "Invoice" : "Credit note",
    number: doc.number,
    issuedAt: doc.issuedAt,
    seller: doc.seller,
    order: { id: order.id, number: order.number, ref: order.paymentIntentId, placedAt: order.paidAt ?? order.createdAt },
    buyer: {
      name: a.name,
      email: order.email,
      address: [a.line1, a.line2, [a.city, a.region].filter(Boolean).join(", ") + ` ${a.postalCode}`, a.country].filter((l): l is string => !!l && !!l.trim()),
      ...business,
    },
    currency: due.currency,
    lines: lines.map((l, n) => ({ id: l.id, title: l.title, quantity: l.quantity, unitMinor: Math.round(due.lines[n]! / l.quantity), totalMinor: due.lines[n]! })),
    subtotalMinor: due.subtotalMinor,
    discount: due.discountMinor > 0 ? { label: order.discountCode ? `Discount (${order.discountCode})` : order.bundleTitle ? `Bundle (${order.bundleTitle})` : "Discount", amountMinor: due.discountMinor } : null,
    shipping: { label: order.shippingMethod ? `Shipping (${order.shippingMethod})` : "Shipping", amountMinor: due.shippingMinor },
    tax: order.taxBreakdown.map((t, i) => ({ label: t.label, ratePct: t.rateBps / 100, amountMinor: taxParts[i]! })),
    taxIncluded: order.taxIncluded,
    /** The buyer's exemption number when no tax was charged because they're exempt. */
    taxExemptId: order.taxExemptId,
    totalMinor: due.totalMinor,
    giftCardMinor: due.giftCardMinor,
    paidMinor: due.chargedMinor,
    /** When the buyer paid in another currency: the total in the store's own. */
    converted: order.presentment ? { currency: order.currency, totalMinor: order.totalMinor, rate: order.presentment.rate } : null,
    credit,
  };
}
export type InvoiceDocument = Awaited<ReturnType<typeof invoiceDocument>>;

/** Documents issued in a date range, newest first, with amounts in the store's currency. */
export async function listInvoices(db: Db, shopId: string, range: { from?: Date; to?: Date } = {}, limit = 500) {
  const i = schema.invoices;
  const rows = await db
    .select({ doc: i, order: schema.orders, refund: schema.refunds })
    .from(i)
    .innerJoin(schema.orders, eq(schema.orders.id, i.orderId))
    .leftJoin(schema.refunds, eq(schema.refunds.id, i.refundId))
    .where(and(eq(i.shopId, shopId), range.from ? gte(i.issuedAt, range.from) : undefined, range.to ? lte(i.issuedAt, range.to) : undefined))
    .orderBy(desc(i.seq))
    .limit(limit);
  return rows.map(({ doc, order, refund }) => ({
    id: doc.id,
    kind: doc.kind,
    number: doc.number,
    issuedAt: doc.issuedAt,
    orderId: order.id,
    orderNumber: order.number,
    buyer: order.shippingAddress.name,
    email: order.email,
    country: order.shippingAddress.country,
    currency: order.currency,
    totalMinor: refund ? -refund.amountMinor : order.totalMinor,
    taxMinor: refund ? -refund.taxRefundedMinor : order.taxMinor,
  }));
}

/** The invoice register, for an accountant. */
export async function invoicesCsv(db: Db, shop: Shop, range: { from: Date; to: Date }) {
  const rows = (await listInvoices(db, shop.id, range, 100_000)).reverse();
  const money = (m: number) => (m / 100).toFixed(2);
  const header = ["number", "type", "date", "order", "buyer", "email", "country", `total (${shop.currency})`, "of which tax"];
  return (
    [header, ...rows.map((r) => [r.number, r.kind === "invoice" ? "invoice" : "credit note", r.issuedAt.toISOString().slice(0, 10), `#${r.orderNumber}`, r.buyer, r.email, r.country, money(r.totalMinor), money(r.taxMinor)])]
      .map((line) => line.map(csvCell).join(","))
      .join("\n") + "\n"
  );
}
