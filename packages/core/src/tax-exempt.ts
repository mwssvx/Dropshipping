// Tax-exempt buyers. A reseller or a charity with an exemption certificate shouldn't be charged
// sales tax or VAT. The merchant records the certificate or resale number on the customer's page,
// and from then on that buyer's orders have no tax, as long as they're signed in to their store
// account: typing the email at checkout isn't enough, or anyone could. The number is kept on each
// order and printed on its invoice, for the merchant's tax records.
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";

export const MAX_EXEMPTION_LENGTH = 60;

/** Records a customer's exemption number, or removes it (null or empty). */
export async function setTaxExemption(db: Db, shopId: string, customerId: string, number: string | null) {
  const value = (number ?? "").trim().replace(/\s+/g, " ") || null;
  if (value && value.length > MAX_EXEMPTION_LENGTH) throw new UserError(`Keep the number under ${MAX_EXEMPTION_LENGTH} characters.`);
  const [row] = await db
    .update(schema.customers)
    .set({ taxExemptId: value })
    .where(and(eq(schema.customers.id, customerId), eq(schema.customers.shopId, shopId)))
    .returning({ id: schema.customers.id, email: schema.customers.email, taxExemptId: schema.customers.taxExemptId });
  if (!row) throw new NotFoundError("Customer");
  return row;
}

/** The exemption number of the buyer with this email, or null when they pay tax. */
export async function taxExemptionFor(db: Db, shopId: string, email: string | null | undefined) {
  if (!email?.trim()) return null;
  const c = await db.query.customers.findFirst({
    where: and(eq(schema.customers.shopId, shopId), eq(schema.customers.email, email.trim().toLowerCase())),
    columns: { taxExemptId: true },
  });
  return c?.taxExemptId ?? null;
}
