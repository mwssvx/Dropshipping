// Search engine listings: each product can have its own title and description for search results
// (the product's own are used when they're empty), and a report lists what's holding products
// back: supplier filler in titles, titles too long to show in full, nothing to show under the
// title, two products with the same name, and no photo.
import { and, asc, eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { productPhotos } from "./gallery";

type Product = typeof schema.products.$inferSelect;

/** Search engines cut titles and descriptions around these lengths. */
export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 160;

const seoInput = z.object({
  title: z.string().trim().max(SEO_TITLE_MAX, `Keep the search title to ${SEO_TITLE_MAX} characters, or search engines cut it off.`),
  description: z.string().trim().max(SEO_DESCRIPTION_MAX, `Keep the search description to ${SEO_DESCRIPTION_MAX} characters, or search engines cut it off.`),
});

/** Saves a product's search title and description; empty ones fall back to its own. */
export async function setProductSeo(db: Db, shopId: string, productId: string, input: z.input<typeof seoInput>) {
  const parsed = seoInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const clean = (s: string) => s.replace(/\s+/g, " ") || null;
  const [row] = await db
    .update(schema.products)
    .set({ seoTitle: clean(parsed.data.title), seoDescription: clean(parsed.data.description), updatedAt: new Date() })
    .where(and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)))
    .returning({ seoTitle: schema.products.seoTitle, seoDescription: schema.products.seoDescription });
  if (!row) throw new NotFoundError("Product");
  return row;
}

/** Plain text of a description, cut to fit under a search result. */
export function searchSnippet(text: string, max = SEO_DESCRIPTION_MAX) {
  const flat = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 3).trimEnd()}...` : flat;
}

/** What a search engine shows for this product. */
export function productSearchListing(p: Pick<Product, "title" | "descriptionHtml" | "seoTitle" | "seoDescription">) {
  return { title: p.seoTitle || p.title, description: p.seoDescription || searchSnippet(p.descriptionHtml) };
}

// Words suppliers stuff into titles that buyers don't search for and that look spammy in results.
const FILLER = /\b(hot sale|free shipping|new arrivals?|best sellers?|top quality|high quality|wholesale|dropshipping|factory direct|20\d\d new|new 20\d\d)\b/i;
// Short capitalised words that are fine: units, standards and country codes.
const CAPS_OK = new Set(["USB", "LED", "LCD", "HDMI", "RGB", "GPS", "USA", "UK", "EU", "UV", "HD", "4K", "DIY", "XL", "XXL", "TV", "PC"]);

export const SEO_ISSUES = {
  filler: "Supplier filler in the title, like \"hot sale\" or capital letters",
  long_title: `Title longer than ${SEO_TITLE_MAX} characters, so it's cut off in results`,
  no_description: "Nothing useful to show under the title in results",
  duplicate_title: "Same title as another product",
  no_photo: "No photo, so it can't show in image results or shopping ads",
} as const;
export type SeoIssue = keyof typeof SEO_ISSUES;

/** The issues with one product's search listing. `titles` counts every active product's title. */
export function seoIssuesOf(p: Pick<Product, "title" | "descriptionHtml" | "seoTitle" | "seoDescription" | "imageUrl" | "images">, titles: Map<string, number>) {
  const listing = productSearchListing(p);
  const issues: SeoIssue[] = [];
  const shouty = listing.title.split(/[^A-Za-z0-9]+/).filter((w) => w.length >= 3 && /[A-Z]/.test(w) && w === w.toUpperCase() && !CAPS_OK.has(w));
  if (FILLER.test(listing.title) || shouty.length >= 2) issues.push("filler");
  if (listing.title.length > SEO_TITLE_MAX) issues.push("long_title");
  if (listing.description.length < 50) issues.push("no_description");
  if ((titles.get(listing.title.trim().toLowerCase()) ?? 0) > 1) issues.push("duplicate_title");
  if (!p.imageUrl && !p.images.length) issues.push("no_photo");
  return issues;
}

/** Active products with something to fix, most issues first, and how many are fine. */
export async function seoReport(db: Db, shopId: string) {
  const products = await db.query.products.findMany({
    where: and(eq(schema.products.shopId, shopId), eq(schema.products.status, "active"), eq(schema.products.giftCard, false)),
    orderBy: asc(schema.products.title),
  });
  const titles = new Map<string, number>();
  for (const p of products) {
    const key = productSearchListing(p).title.trim().toLowerCase();
    titles.set(key, (titles.get(key) ?? 0) + 1);
  }
  const rows = products.map((p) => ({ id: p.id, title: p.title, listing: productSearchListing(p), issues: seoIssuesOf(p, titles) }));
  const needsWork = rows.filter((r) => r.issues.length).sort((a, b) => b.issues.length - a.issues.length);
  // Photos with no description are listed apart: most supplier products start that way, and it
  // shouldn't hide the listings that look bad in results.
  const undescribed = products
    .map((p) => ({ id: p.id, title: p.title, photos: productPhotos(p).filter((url) => !p.imageAlts?.[url]).length }))
    .filter((p) => p.photos > 0);
  return { checked: rows.length, fine: rows.length - needsWork.length, products: needsWork, undescribed };
}
