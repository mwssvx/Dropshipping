// Moving from Shopify: the products file Shopify exports (Products → Export → CSV) comes in as
// products here, with their options, prices, costs, stock, photos and search listings. Handles
// are kept, so /products/<handle> links and search results still work once the domain points
// here. One product spans several rows in that file: the first has the product, the rest add
// options and photos.
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { UserError } from "./errors";
import { photoColumns, isPhotoUrl } from "./gallery";
import { toHandle } from "./handles";
import { MAX_OPTIONS, MAX_VARIANTS } from "./products";
import { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from "./seo";
import { addRedirect } from "./redirects";

/** Big enough for a large catalogue, small enough for one request. */
export const SHOPIFY_MAX_PRODUCTS = 2000;
const MAX_BYTES = 10 * 1024 * 1024;

/** Rows and fields of a CSV file: quotes, doubled quotes and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim()));
}

/** "19.99" or "1,299.00" in minor units; null when empty or not a price. */
function money(raw: string | undefined) {
  const t = (raw ?? "").replace(/[,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export type ShopifyVariant = {
  title: string;
  options: Record<string, string>;
  sku: string | null;
  priceMinor: number;
  compareAtMinor: number | null;
  costMinor: number | null;
  stock: number | null;
  imageUrl: string | null;
};
export type ShopifyProduct = {
  handle: string;
  title: string;
  descriptionHtml: string;
  status: "active" | "draft" | "archived";
  images: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  variants: ShopifyVariant[];
};

/** The products in a Shopify products file, and what couldn't be read. */
export function readShopifyProducts(text: string) {
  if (text.length > MAX_BYTES) throw new UserError("That file is over 10 MB. Export fewer products at a time, like one collection.");
  const [header, ...rows] = parseCsv(text);
  const col = new Map((header ?? []).map((h, i) => [h.trim().toLowerCase(), i]));
  if (!col.has("handle") || !col.has("title") || !col.has("variant price")) {
    throw new UserError("That isn't a Shopify products file. In Shopify, open Products, then Export, and pick \"CSV for Excel, Numbers, or other spreadsheet programs\".");
  }
  const get = (r: string[], name: string) => {
    const i = col.get(name);
    return i === undefined ? "" : (r[i] ?? "").trim();
  };
  const products = new Map<string, ShopifyProduct & { optionNames: string[]; photos: { url: string; position: number }[]; giftCard: boolean }>();
  const problems: string[] = [];
  for (const [n, r] of rows.entries()) {
    const line = n + 2;
    const handle = get(r, "handle");
    if (!handle) continue;
    let p = products.get(handle);
    if (!p) {
      if (!get(r, "title")) {
        problems.push(`Row ${line}: ${handle} has no title, so it was left out.`);
        continue;
      }
      if (products.size >= SHOPIFY_MAX_PRODUCTS) {
        problems.push(`Only the first ${SHOPIFY_MAX_PRODUCTS} products were read. Import the rest in a second file.`);
        break;
      }
      const status = get(r, "status").toLowerCase();
      p = {
        handle,
        title: get(r, "title").slice(0, 200),
        descriptionHtml: get(r, "body (html)").slice(0, 50_000),
        // Older exports have only "Published".
        status: status === "active" || status === "draft" || status === "archived" ? status : get(r, "published").toLowerCase() === "true" ? "active" : "draft",
        images: [],
        seoTitle: get(r, "seo title").slice(0, SEO_TITLE_MAX) || null,
        seoDescription: get(r, "seo description").slice(0, SEO_DESCRIPTION_MAX) || null,
        variants: [],
        optionNames: [1, 2, 3].map((i) => get(r, `option${i} name`)).filter(Boolean),
        photos: [],
        giftCard: get(r, "gift card").toLowerCase() === "true",
      };
      products.set(handle, p);
    }
    const src = get(r, "image src");
    if (src && isPhotoUrl(src)) p.photos.push({ url: src, position: Number(get(r, "image position")) || 1000 + p.photos.length });
    // A row with a price is an option; rows without one only add photos.
    const priceRaw = get(r, "variant price");
    if (!priceRaw) continue;
    const priceMinor = money(priceRaw);
    if (priceMinor === null) {
      problems.push(`Row ${line}: "${priceRaw}" isn't a price, so that option of ${p.title} was left out.`);
      continue;
    }
    const values = [1, 2, 3].map((i) => get(r, `option${i} value`));
    const options: Record<string, string> = {};
    p.optionNames.slice(0, MAX_OPTIONS).forEach((name, i) => {
      if (values[i]) options[name.slice(0, 40)] = values[i]!.slice(0, 60);
    });
    // Shopify names a product with no options "Title: Default Title".
    const plain = p.optionNames[0] === "Title" && values[0] === "Default Title";
    if (p.variants.length >= MAX_VARIANTS) {
      if (p.variants.length === MAX_VARIANTS) problems.push(`${p.title} has more than ${MAX_VARIANTS} options; the first ${MAX_VARIANTS} came in.`);
      continue;
    }
    const tracked = get(r, "variant inventory tracker").toLowerCase() === "shopify";
    const qty = Number.parseInt(get(r, "variant inventory qty"), 10);
    const image = get(r, "variant image");
    p.variants.push({
      title: plain ? "Default" : values.filter(Boolean).join(" / ").slice(0, 200) || "Default",
      options: plain ? {} : options,
      sku: get(r, "variant sku").slice(0, 100) || null,
      priceMinor,
      compareAtMinor: money(get(r, "variant compare at price")),
      costMinor: money(get(r, "cost per item")),
      stock: tracked && Number.isFinite(qty) ? Math.max(0, qty) : null,
      imageUrl: image && isPhotoUrl(image) ? image : null,
    });
  }
  const out: ShopifyProduct[] = [];
  for (const p of products.values()) {
    if (p.giftCard) {
      problems.push(`${p.title} is a gift card. Make gift cards under Gift cards instead.`);
      continue;
    }
    if (!p.variants.length) {
      problems.push(`${p.title} has no price, so it was left out.`);
      continue;
    }
    const { optionNames: _o, photos, giftCard: _g, ...rest } = p;
    out.push({ ...rest, images: photoColumns(photos.sort((a, b) => a.position - b.position).map((x) => x.url)).images });
  }
  return { products: out, problems };
}

/**
 * Adds the products in a Shopify products file. Products whose handle is already in the store
 * are skipped, so importing the same file twice adds nothing. With `keepStatus` off, everything
 * comes in as a draft to check before it goes on sale.
 */
export async function importShopifyProducts(db: Db, shopId: string, text: string, opts: { keepStatus?: boolean } = {}) {
  const { products, problems } = readShopifyProducts(text);
  if (!products.length) throw new UserError(problems[0] ?? "There are no products in that file.");
  const handles = products.map((p) => toHandle(p.handle));
  const taken = new Set<string>();
  for (let i = 0; i < handles.length; i += 500) {
    const rows = await db
      .select({ handle: schema.products.handle })
      .from(schema.products)
      .where(and(eq(schema.products.shopId, shopId), inArray(schema.products.handle, handles.slice(i, i + 500))));
    for (const r of rows) taken.add(r.handle);
  }
  let created = 0;
  const skipped: string[] = [];
  for (const p of products) {
    const handle = toHandle(p.handle);
    if (taken.has(handle)) {
      skipped.push(p.title);
      continue;
    }
    taken.add(handle);
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.products)
        .values({
          shopId,
          handle,
          title: p.title,
          descriptionHtml: p.descriptionHtml,
          status: opts.keepStatus ? p.status : "draft",
          seoTitle: p.seoTitle,
          seoDescription: p.seoDescription,
          ...photoColumns(p.images),
        })
        .returning({ id: schema.products.id });
      await tx.insert(schema.variants).values(p.variants.map((v, position) => ({ ...v, productId: row!.id, position })));
    });
    // A handle we had to shorten keeps its old address working.
    if (handle !== p.handle) await addRedirect(db, shopId, { from: `/products/${p.handle}`, to: `/products/${handle}` }).catch(() => {});
    created++;
  }
  return { created, skipped, problems };
}
