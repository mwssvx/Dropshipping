import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { schema, type Db, type PersonalizationField, type PersonalizationValue } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";

/**
 * Personalised products: the merchant adds up to three text fields to a product ("Name to
 * engrave"), the buyer fills them in before adding to cart, and the text travels with the order
 * line to the receipt, the admin and the supplier. The same option with different text is a
 * separate cart line.
 */

export const MAX_PERSONALIZATION_FIELDS = 3;
export const MAX_PERSONALIZATION_LENGTH = 200;

const fieldSchema = z.object({
  id: z.string().optional(),
  label: z.string().trim().min(1, "Give each field a label, like \"Name to engrave\".").max(40, "Keep each label under 40 characters."),
  required: z.boolean(),
  maxLength: z
    .number()
    .int("Enter a whole number of characters.")
    .min(1, "Allow at least 1 character.")
    .max(MAX_PERSONALIZATION_LENGTH, `Fields can be up to ${MAX_PERSONALIZATION_LENGTH} characters.`),
});

export async function setPersonalization(db: Db, shopId: string, productId: string, input: z.input<typeof fieldSchema>[]) {
  const parsed = z.array(fieldSchema).max(MAX_PERSONALIZATION_FIELDS, `Up to ${MAX_PERSONALIZATION_FIELDS} fields per product.`).safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const labels = parsed.data.map((f) => f.label.toLowerCase());
  if (new Set(labels).size !== labels.length) throw new UserError("Each field needs a different label.");
  const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)) });
  if (!product) throw new NotFoundError("Product");
  // Fields keep their id when edited, so carts and subscriptions still match them.
  const known = new Set(product.personalization.map((f) => f.id));
  const fields: PersonalizationField[] = parsed.data.map((f) => ({
    id: f.id && known.has(f.id) ? f.id : randomUUID().slice(0, 8),
    label: f.label,
    required: f.required,
    maxLength: f.maxLength,
  }));
  await db.update(schema.products).set({ personalization: fields, updatedAt: new Date() }).where(eq(schema.products.id, productId));
  return fields;
}

/** Strips control characters and runs of spaces from what the buyer typed. */
function tidy(value: unknown) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
}

/**
 * What the buyer typed for each of the product's fields, cut to each field's length. Fields the
 * product doesn't have are dropped. Returns undefined when nothing was typed.
 */
export function cleanPersonalization(fields: PersonalizationField[], input: Record<string, unknown> | null | undefined) {
  if (!input || !fields.length) return undefined;
  const out: Record<string, string> = {};
  for (const f of fields) {
    const value = [...tidy(input[f.id])].slice(0, f.maxLength).join("");
    if (value) out[f.id] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The text on a cart line, labelled, in the product's field order. */
export function personalizationValues(fields: PersonalizationField[], custom: Record<string, string> | undefined): PersonalizationValue[] | null {
  const values = fields.filter((f) => custom?.[f.id]).map((f) => ({ fieldId: f.id, label: f.label, value: custom![f.id]! }));
  return values.length ? values : null;
}

/** Required fields left empty on a cart line. */
export function missingPersonalization(fields: PersonalizationField[], custom: Record<string, string> | undefined) {
  return fields.filter((f) => f.required && !custom?.[f.id]).map((f) => f.label);
}

/** "Name to engrave: Ada · Font: Script", for receipts, supplier notes and lists. */
export function describePersonalization(values: PersonalizationValue[] | null | undefined) {
  return values?.length ? values.map((v) => `${v.label}: ${v.value}`).join(" · ") : null;
}

/** Back to the cart's shape, for repeat deliveries. */
export function personalizationInput(values: PersonalizationValue[] | null | undefined) {
  return values?.length ? Object.fromEntries(values.map((v) => [v.fieldId, v.value])) : undefined;
}

/** Cart lines are the same when both the option and the text match. */
export function sameCartLine(a: { variantId: string; custom?: Record<string, string> }, b: { variantId: string; custom?: Record<string, string> }) {
  return cartLineKey(a) === cartLineKey(b);
}

export function cartLineKey(l: { variantId: string; custom?: Record<string, string> }) {
  const custom = l.custom ? Object.entries(l.custom).sort(([x], [y]) => x.localeCompare(y)) : [];
  return custom.length ? `${l.variantId}:${JSON.stringify(custom)}` : l.variantId;
}
