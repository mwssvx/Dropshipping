// Product feeds: the store's products as Google Merchant Center (RSS with g: fields) and Meta
// catalog (CSV) want them, so they can run in Google Shopping and Facebook/Instagram shops and ads.
// One item per option, grouped by product. Running sales go in as the sale price with their dates.
// Gift cards and products without a photo or price are left out, and the Sales channels page says
// why, so the merchant can fix them.
import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, type Contents, type Db } from "@sf/db";
import { unitPrice, type UnitReference } from "./unit-price";
import { productPhotos } from "./gallery";
import { localizeProducts, shopLanguages, type Language } from "./languages";
import { listActiveProducts } from "./products";
import { salePrice, salesFor } from "./sales";
import { csvCell } from "./payouts";
import { reviewPhotoUrl } from "./reviews";
import { homeShipping } from "./delivery";

type Shop = typeof schema.shops.$inferSelect;

export const FEED_TITLE_MAX = 150;
export const FEED_DESCRIPTION_MAX = 5000;

export type FeedItem = {
  id: string;
  groupId: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  additionalImageLinks: string[];
  inStock: boolean;
  priceMinor: number;
  salePriceMinor: number | null;
  saleDates: { start: Date; end: Date } | null;
  currency: string;
  brand: string;
  sku: string | null;
  color: string | null;
  size: string | null;
  /** What one holds and the amount its price per unit is for, as Google writes them ("250g", "100g"). */
  unitPricing: { measure: string; base: string } | null;
  /** The option's barcode when it's a real GTIN (UPC, EAN or ITF-14 with a good check digit). */
  gtin: string | null;
  weightGrams: number | null;
  /** A download: nothing to ship. */
  digital: boolean;
  /** The country the parcel leaves from: the product's warehouse abroad, else the store's. Null for downloads. */
  shipsFrom: string | null;
  /** The cheapest shipping to the store's country, with handling and transit days when known. */
  shipping: { country: string; priceMinor: number; handlingDays: number; transit: { min: number; max: number } | null } | null;
};

/** A barcode Google takes as a GTIN: 8, 12, 13 or 14 digits whose last digit checks out. */
export function validGtin(code: string | null | undefined) {
  const digits = code?.replace(/[\s-]/g, "") ?? "";
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits) || /^0+$/.test(digits)) return null;
  const body = digits.slice(0, -1).split("").reverse().map(Number);
  const sum = body.reduce((n, d, i) => n + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1)) ? digits : null;
}

/** Plain text from a description that may hold HTML, on one line. */
export const plainText = (html: string) =>
  html
    .replace(/<(br|\/p|\/li|\/h\d)\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const optionNamed = (options: Record<string, string>, names: string[]) => {
  const key = Object.keys(options).find((k) => names.includes(k.trim().toLowerCase()));
  return key ? options[key]! : null;
};

export type FeedIssue = { productId: string; title: string; problem: string };

/**
 * Every option of every product on sale, ready for a feed, plus what kept products out. Links
 * point at `origin` (the store's address), in `language` when the store offers it.
 */
export async function productFeed(db: Db, shop: Shop, opts: { origin: string; language?: string | null; now?: Date }) {
  const language = opts.language && shopLanguages(shop).includes(opts.language as Language) ? opts.language : null;
  const base = `${opts.origin}${language ? `/${language}` : ""}`;
  const raw = await listActiveProducts(db, shop.id);
  const products = await localizeProducts(db, shop.id, language, raw);
  const sales = await salesFor(db, shop.id, products.map((p) => p.id), opts.now);
  const shipping = await homeShipping(db, shop, products.filter((p) => !p.giftCard && !p.digital).flatMap((p) => p.variants.map((v) => ({ ...v, processingDays: p.processingDays, surchargeMinor: p.shippingSurchargeMinor }))));
  const items: FeedItem[] = [];
  const issues: FeedIssue[] = [];
  for (const p of products) {
    if (p.giftCard) continue;
    const photos = productPhotos(p);
    if (!photos.length) {
      issues.push({ productId: p.id, title: p.title, problem: "Add a photo. Google and Meta don't list products without one." });
      continue;
    }
    if (p.variants.every((v) => v.priceMinor <= 0)) {
      issues.push({ productId: p.id, title: p.title, problem: "Set a price." });
      continue;
    }
    const description = plainText(p.descriptionHtml).slice(0, FEED_DESCRIPTION_MAX) || p.title;
    if (description === p.title) issues.push({ productId: p.id, title: p.title, problem: "Add a description. It's listed with the title for now, which ads rank lower." });
    if (p.title.length > FEED_TITLE_MAX) issues.push({ productId: p.id, title: p.title, problem: `Shorten the title to ${FEED_TITLE_MAX} characters. It's cut off in the feed.` });
    const sale = sales.get(p.id);
    for (const v of p.variants) {
      if (v.priceMinor <= 0) continue;
      const many = p.variants.length > 1 && v.title !== "Default";
      const priced = salePrice(v.priceMinor, v.compareAtMinor, sale);
      // A crossed-out price the merchant set counts as the regular price too.
      const regular = Math.max(v.priceMinor, v.compareAtMinor ?? 0);
      items.push({
        id: v.id,
        groupId: p.id,
        title: (many ? `${p.title} – ${v.title}` : p.title).slice(0, FEED_TITLE_MAX),
        description,
        link: `${base}/products/${p.handle}`,
        imageLink: photos[0]!,
        additionalImageLinks: photos.slice(1, 11),
        inStock: v.stock === null || v.stock > 0,
        priceMinor: regular,
        salePriceMinor: priced.priceMinor < regular ? priced.priceMinor : null,
        saleDates: sale?.endsAt && priced.priceMinor < regular ? { start: sale.startsAt, end: sale.endsAt } : null,
        currency: shop.currency,
        brand: shop.name,
        sku: v.sku,
        color: optionNamed(v.options, ["color", "colour", "farbe", "couleur"]),
        size: optionNamed(v.options, ["size", "größe", "taille", "talla"]),
        unitPricing: googleUnitPricing(v.contents),
        gtin: validGtin(v.barcode),
        weightGrams: p.digital ? null : v.weightGrams,
        digital: p.digital,
        shipsFrom: p.digital ? null : (p.shipsFrom ?? shop.country),
        shipping: p.digital ? null : (shipping.get(v.id) ?? null),
      });
    }
  }
  return { items, issues, language };
}

const GOOGLE_UNITS: Record<Contents["unit"], string> = { g: "g", kg: "kg", ml: "ml", cl: "cl", l: "l", cm: "cm", m: "m", m2: "sqm", item: "ct" };
const GOOGLE_BASE: Record<UnitReference, string> = { "100 g": "100g", kg: "1kg", "100 ml": "100ml", l: "1l", m: "1m", "m²": "1sqm", item: "1ct" };

/** Google's unit pricing fields for what a variant holds, matching the price per unit on the store. */
function googleUnitPricing(contents: Contents | null) {
  const unit = contents ? unitPrice(100, contents) : null;
  return contents && unit ? { measure: `${contents.amount}${GOOGLE_UNITS[contents.unit]}`, base: GOOGLE_BASE[unit.per] } : null;
}

const price = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency}`;
/** "2026-10-10T09:00Z/2026-10-17T09:00Z", as both feeds take a sale's dates. */
const dates = (d: { start: Date; end: Date }) => `${d.start.toISOString().slice(0, 16)}Z/${d.end.toISOString().slice(0, 16)}Z`;
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Google Merchant Center's RSS 2.0 format. */
export function googleFeedXml(shop: Pick<Shop, "name">, origin: string, items: FeedItem[]) {
  const tag = (name: string, value: string | null | undefined) => (value ? `<${name}>${xml(value)}</${name}>` : "");
  const entries = items.map((i) =>
    [
      "<item>",
      tag("g:id", i.id),
      tag("g:item_group_id", i.groupId),
      tag("g:title", i.title),
      tag("g:description", i.description),
      tag("g:link", i.link),
      tag("g:image_link", i.imageLink),
      ...i.additionalImageLinks.map((l) => tag("g:additional_image_link", l)),
      tag("g:availability", i.inStock ? "in_stock" : "out_of_stock"),
      tag("g:price", price(i.priceMinor, i.currency)),
      i.salePriceMinor !== null ? tag("g:sale_price", price(i.salePriceMinor, i.currency)) : "",
      i.saleDates ? tag("g:sale_price_effective_date", dates(i.saleDates)) : "",
      tag("g:condition", "new"),
      tag("g:brand", i.brand),
      i.gtin ? tag("g:gtin", i.gtin) : "",
      i.sku ? tag("g:mpn", i.sku) : i.gtin ? "" : tag("g:identifier_exists", "no"),
      tag("g:color", i.color),
      tag("g:size", i.size),
      i.unitPricing ? tag("g:unit_pricing_measure", i.unitPricing.measure) + tag("g:unit_pricing_base_measure", i.unitPricing.base) : "",
      i.shipping
        ? `<g:shipping>${tag("g:country", i.shipping.country)}${tag("g:price", price(i.shipping.priceMinor, i.currency))}${
            i.shipping.transit
              ? tag("g:min_handling_time", "0") + tag("g:max_handling_time", String(i.shipping.handlingDays)) + tag("g:min_transit_time", String(i.shipping.transit.min)) + tag("g:max_transit_time", String(i.shipping.transit.max))
              : ""
          }</g:shipping>`
        : "",
      i.weightGrams ? tag("g:shipping_weight", `${i.weightGrams} g`) : "",
      tag("g:ships_from_country", i.shipsFrom),
      "</item>",
    ]
      .filter(Boolean)
      .join(""),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>${xml(shop.name)}</title>
<link>${xml(origin)}</link>
<description>${xml(`Products from ${shop.name}`)}</description>
${entries.join("\n")}
</channel>
</rss>
`;
}

/** Meta (Facebook and Instagram) catalog CSV. */
export function metaFeedCsv(items: FeedItem[]) {
  const header = ["id", "item_group_id", "title", "description", "availability", "condition", "price", "sale_price", "sale_price_effective_date", "link", "image_link", "additional_image_link", "brand", "color", "size", "gtin", "shipping", "shipping_weight"];
  const rows = items.map((i) => [
    i.id,
    i.groupId,
    i.title,
    i.description,
    i.inStock ? "in stock" : "out of stock",
    "new",
    price(i.priceMinor, i.currency),
    i.salePriceMinor !== null ? price(i.salePriceMinor, i.currency) : "",
    i.saleDates ? dates(i.saleDates) : "",
    i.link,
    i.imageLink,
    i.additionalImageLinks.join(","),
    i.brand,
    i.color,
    i.size,
    i.gtin,
    // Meta's "country:region:service:price".
    i.shipping ? `${i.shipping.country}::Standard:${price(i.shipping.priceMinor, i.currency)}` : "",
    i.weightGrams ? `${i.weightGrams} g` : "",
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

// Product reviews --------------------------------------------------------------------------------

/** The most reviews in the feed, newest first. */
export const REVIEW_FEED_MAX = 10_000;

/**
 * The store's published reviews in Google's product review feed format (schema 2.3), for product
 * ratings: the stars under Google Shopping ads and listings. Products are matched by the same SKUs,
 * brand and links as the product feed. Reviews shoppers reported wait until the merchant looks.
 */
export async function reviewFeedXml(db: Db, shop: Pick<Shop, "id" | "name">, origin: string) {
  const r = schema.reviews;
  const rows = await db
    .select({ review: r, handle: schema.products.handle, title: schema.products.title })
    .from(r)
    .innerJoin(schema.products, eq(schema.products.id, r.productId))
    .where(and(eq(r.shopId, shop.id), eq(r.status, "published"), eq(r.reportCount, 0), eq(schema.products.status, "active")))
    .orderBy(desc(r.createdAt), desc(r.id))
    .limit(REVIEW_FEED_MAX);
  const productIds = [...new Set(rows.map((x) => x.review.productId))];
  const skus = new Map<string, string[]>();
  if (productIds.length) {
    const variants = await db.select({ productId: schema.variants.productId, sku: schema.variants.sku }).from(schema.variants).where(inArray(schema.variants.productId, productIds));
    for (const v of variants) if (v.sku) skus.set(v.productId, [...(skus.get(v.productId) ?? []), v.sku]);
  }
  const tag = (name: string, value: string) => `<${name}>${xml(value)}</${name}>`;
  const entries = rows.map(({ review: x, handle, title }) => {
    const link = `${origin}/products/${encodeURIComponent(handle)}`;
    const ids = skus.get(x.productId) ?? [];
    return [
      "<review>",
      tag("review_id", x.id),
      `<reviewer><name is_anonymous="false">${xml(x.name)}</name></reviewer>`,
      tag("review_timestamp", x.createdAt.toISOString()),
      tag("content", x.body),
      x.photoIds.length ? `<reviewer_images>${x.photoIds.map((p) => `<reviewer_image>${tag("url", new URL(reviewPhotoUrl(p), origin).toString())}</reviewer_image>`).join("")}</reviewer_images>` : "",
      `<review_url type="singleton">${xml(`${link}#review-${x.id}`)}</review_url>`,
      `<ratings><overall min="1" max="5">${x.rating}</overall></ratings>`,
      "<products><product>",
      "<product_ids>",
      ids.length ? `<skus>${ids.map((s) => tag("sku", s)).join("")}</skus>` : "",
      `<brands>${tag("brand", shop.name)}</brands>`,
      "</product_ids>",
      tag("product_name", title),
      tag("product_url", link),
      "</product></products>",
      tag("is_spam", "false"),
      // Reviews written after an order here were asked for once it shipped; imported ones we can't tell.
      x.orderId ? tag("collection_method", "post_fulfillment") : "",
      "</review>",
    ]
      .filter(Boolean)
      .join("");
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:vc="http://www.w3.org/2007/XMLSchema-versioning" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.google.com/shopping/reviews/schema/product/2.3/product_reviews.xsd">
<version>2.3</version>
<publisher>${tag("name", shop.name)}</publisher>
<reviews>
${entries.join("\n")}
</reviews>
</feed>
`;
}
