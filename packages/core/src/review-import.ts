// Bringing reviews over: the merchant's own reviews, exported from the review app they used on
// Shopify (Shopify's Product Reviews or Judge.me), are added to the matching products here. They
// keep their date, name, stars, text and the merchant's reply. They aren't tied to an order here,
// so the store doesn't call them "Verified buyer". Photos and email addresses aren't brought over.
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { UserError } from "./errors";
import { parseCsv } from "./shopify-import";

export const MAX_IMPORTED_REVIEWS = 5000;

type Format = "Shopify Product Reviews" | "Judge.me";

export type ImportedReview = {
  handle: string;
  name: string;
  rating: number;
  body: string;
  reply: string | null;
  createdAt: Date | null;
  status: "published" | "hidden" | "pending";
};

const pick = (row: string[], at: number | undefined) => (at === undefined || at < 0 ? "" : (row[at] ?? "").trim());

/** Reads a reviews export. Says which format it was, and how many rows couldn't be used. */
export function readReviewsCsv(text: string) {
  const [header, ...rows] = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  const cols = (header ?? []).map((h) => h.trim().toLowerCase());
  const at = (...names: string[]) => names.map((n) => cols.indexOf(n)).find((i) => i >= 0);
  const format: Format | null = cols.includes("reviewer_name") || cols.includes("curated") ? "Judge.me" : cols.includes("product_handle") && cols.includes("author") ? "Shopify Product Reviews" : null;
  if (!format || at("product_handle") === undefined || at("rating") === undefined || at("body") === undefined) {
    throw new UserError("That doesn't look like a reviews export. Use the CSV from Shopify's Product Reviews app or from Judge.me.");
  }
  if (rows.length > MAX_IMPORTED_REVIEWS) throw new UserError(`That file has more than ${MAX_IMPORTED_REVIEWS.toLocaleString("en-US")} reviews. Split it into smaller files.`);
  const i = {
    handle: at("product_handle"),
    rating: at("rating"),
    title: at("title"),
    body: at("body"),
    name: at("author", "reviewer_name"),
    reply: at("reply"),
    date: at("created_at", "review_date"),
    state: at("state", "curated"),
  };
  const reviews: ImportedReview[] = [];
  let unusable = 0;
  for (const row of rows) {
    const handle = pick(row, i.handle).toLowerCase();
    const rating = Number(pick(row, i.rating));
    const title = pick(row, i.title);
    const text = pick(row, i.body);
    const state = pick(row, i.state).toLowerCase();
    // Spam stays behind; so does anything without a product, a 1 to 5 rating or any words.
    if (!handle || !Number.isInteger(rating) || rating < 1 || rating > 5 || (!text && !title) || state === "spam") {
      unusable++;
      continue;
    }
    // The title, when there is one, is the first line, as reviews here have no separate title.
    const body = (title && !text.toLowerCase().startsWith(title.toLowerCase()) ? `${title}\n${text}` : text || title).slice(0, 2000).trim();
    const when = new Date(pick(row, i.date));
    reviews.push({
      handle,
      name: (pick(row, i.name) || "Buyer").slice(0, 60),
      rating,
      body,
      reply: pick(row, i.reply).slice(0, 1000) || null,
      createdAt: Number.isNaN(when.getTime()) ? null : when,
      // Shopify says published or unpublished; Judge.me says ok, not-yet or spam.
      status: state === "published" || state === "ok" ? "published" : state === "unpublished" ? "hidden" : "pending",
    });
  }
  return { format, reviews, unusable };
}

const keyOf = (r: ImportedReview) => createHash("sha256").update([r.handle, r.name, r.rating, r.body, r.createdAt?.toISOString() ?? ""].join("\u0000")).digest("hex");

/**
 * Adds the reviews in an export to the products with the same web address (handle). Adding the
 * same file again adds nothing new. Reviews for products that aren't here are counted, not added.
 */
export async function importReviews(db: Db, shopId: string, text: string) {
  const { format, reviews, unusable } = readReviewsCsv(text);
  const handles = [...new Set(reviews.map((r) => r.handle))];
  const products = handles.length
    ? await db.query.products.findMany({ where: and(eq(schema.products.shopId, shopId), inArray(schema.products.handle, handles)), columns: { id: true, handle: true } })
    : [];
  const byHandle = new Map(products.map((p) => [p.handle, p.id]));
  const rows = reviews.flatMap((r) => {
    const productId = byHandle.get(r.handle);
    if (!productId) return [];
    return [{
      shopId,
      productId,
      name: r.name,
      rating: r.rating,
      body: r.body,
      reply: r.reply,
      status: r.status,
      importedFrom: format,
      importKey: keyOf(r),
      ...(r.createdAt ? { createdAt: r.createdAt } : {}),
    }];
  });
  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const inserted = await db.insert(schema.reviews).values(rows.slice(i, i + 500)).onConflictDoNothing().returning({ id: schema.reviews.id });
    added += inserted.length;
  }
  const missing = [...new Set(reviews.filter((r) => !byHandle.has(r.handle)).map((r) => r.handle))];
  return {
    format,
    added,
    alreadyHere: rows.length - added,
    // Products the file reviews that this store doesn't have (yet): move the products first.
    missingProducts: missing.slice(0, 20),
    missingCount: reviews.filter((r) => !byHandle.has(r.handle)).length,
    unusable,
  };
}
