// Product feeds: the store's products as Google Merchant Center (RSS with g: fields) and Meta
// catalog (CSV) want them, so they can run in Google Shopping and Facebook/Instagram shops and ads.
// One item per option, grouped by product. Running sales go in as the sale price with their dates.
// Gift cards and products without a photo or price are left out, and the Sales channels page says
// why, so the merchant can fix them.
import { schema, type Db } from "@sf/db";
import { productPhotos } from "./gallery";
import { localizeProducts, shopLanguages, type Language } from "./languages";
import { listActiveProducts } from "./products";
import { salePrice, salesFor } from "./sales";
import { csvCell } from "./payouts";

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
};

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
      });
    }
  }
  return { items, issues, language };
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
      i.sku ? tag("g:mpn", i.sku) : tag("g:identifier_exists", "no"),
      tag("g:color", i.color),
      tag("g:size", i.size),
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
  const header = ["id", "item_group_id", "title", "description", "availability", "condition", "price", "sale_price", "sale_price_effective_date", "link", "image_link", "additional_image_link", "brand", "color", "size"];
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
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}
