// Product details: short facts shown as a table on the product page (Material: Aluminium,
// Size: 20 × 10 cm, Power: USB-C). The merchant writes one per line, label first, and the same
// text is what translators and the AI translator get, so the table follows the buyer's language.
import { and, eq } from "drizzle-orm";
import { schema, type Db, type ProductDetail } from "@sf/db";
import { NotFoundError, UserError } from "./errors";

export const MAX_DETAILS = 20;
const MAX_LABEL = 40;
const MAX_VALUE = 200;

/**
 * Reads "Label: value" lines. Strict (what the merchant saves) says which line is wrong; lenient
 * (a translation) keeps the lines it can read.
 */
export function parseDetails(text: string, opts: { strict?: boolean } = {}): ProductDetail[] {
  const out: ProductDetail[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.indexOf(":");
    const label = at > 0 ? line.slice(0, at).trim() : "";
    const value = at > 0 ? line.slice(at + 1).trim() : "";
    const problem = !label || !value
      ? `Line ${i + 1} needs a label and a value with a colon between them, like "Material: Aluminium".`
      : label.length > MAX_LABEL
        ? `Line ${i + 1}: keep the label under ${MAX_LABEL} characters.`
        : value.length > MAX_VALUE
          ? `Line ${i + 1}: keep the value under ${MAX_VALUE} characters.`
          : /<[a-z/][^>]*>/i.test(line)
            ? `Line ${i + 1}: details are plain text, without HTML tags.`
            : null;
    if (problem) {
      if (opts.strict) throw new UserError(problem);
      continue;
    }
    out.push({ label, value });
  }
  if (out.length > MAX_DETAILS) {
    if (opts.strict) throw new UserError(`A product can have up to ${MAX_DETAILS} details.`);
    return out.slice(0, MAX_DETAILS);
  }
  return out;
}

/** The details as the merchant writes them, one "Label: value" per line. */
export function detailsText(details: ProductDetail[]) {
  return details.map((d) => `${d.label}: ${d.value}`).join("\n");
}

/** Saves a product's details from the merchant's text; an empty box removes them. */
export async function setProductDetails(db: Db, shopId: string, productId: string, text: string) {
  const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)), columns: { id: true } });
  if (!product) throw new NotFoundError("Product");
  const details = parseDetails(text, { strict: true });
  await db.update(schema.products).set({ details, updatedAt: new Date() }).where(eq(schema.products.id, productId));
  return details;
}
