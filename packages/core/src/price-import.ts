// Prices and stock from a spreadsheet. A merchant downloads their products (Export → products.csv),
// changes prices, compare-at prices, costs or stock counts in a spreadsheet, and uploads it again.
// Rows are matched by SKU, or by Handle and Variant. An empty cell leaves that value as it is, and
// uploading the same file twice changes nothing the second time. Stock is only changed for stock
// the store keeps itself: a supplier's counts come from the supplier.
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { UserError } from "./errors";
import { recordStockCount } from "./inventory";
import { parseMoney } from "./money";
import { parseCsv } from "./shopify-import";

export const MAX_PRICE_ROWS = 5000;

export type PriceImportResult = {
  /** Options with at least one value changed. */
  changed: number;
  /** Options found whose values already matched the file. */
  unchanged: number;
  /** Rows (or values in them) that weren't used, with the line they're on and why. */
  skipped: { line: number; ref: string; reason: string }[];
};

type Row = { line: number; handle: string; variant: string; sku: string; price: string; compareAt: string; cost: string; stock: string };

/** Reads the file's columns: ours from the products download, and Shopify's names for the same things. */
export function readPriceCsv(text: string): Row[] {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ""));
  const cols = (header ?? []).map((h) => h.trim().toLowerCase());
  const at = (...names: string[]) => names.map((n) => cols.indexOf(n)).find((i) => i >= 0);
  const i = {
    handle: at("handle"),
    variant: at("variant", "option", "option1 value"),
    sku: at("sku", "variant sku"),
    price: at("price", "variant price"),
    compareAt: at("compare at price", "compare-at price", "variant compare at price"),
    cost: at("cost", "cost per item"),
    stock: at("stock", "inventory", "quantity", "variant inventory qty"),
  };
  if (i.sku === undefined && i.handle === undefined) {
    throw new UserError("The file needs a SKU or a Handle column to find each product. Download your products to start from.");
  }
  if ([i.price, i.compareAt, i.cost, i.stock].every((n) => n === undefined)) {
    throw new UserError("The file needs a Price, Compare at price, Cost or Stock column to change.");
  }
  const cell = (row: string[], n: number | undefined) => (n === undefined ? "" : (row[n] ?? "").trim());
  const out: Row[] = [];
  rows.forEach((row, n) => {
    if (!row.some((c) => c.trim())) return;
    out.push({
      line: n + 2,
      handle: cell(row, i.handle).toLowerCase(),
      variant: cell(row, i.variant),
      sku: cell(row, i.sku),
      price: cell(row, i.price),
      compareAt: cell(row, i.compareAt),
      cost: cell(row, i.cost),
      stock: cell(row, i.stock),
    });
  });
  if (out.length > MAX_PRICE_ROWS) throw new UserError(`That file has more than ${MAX_PRICE_ROWS.toLocaleString("en-US")} rows. Split it into smaller files.`);
  return out;
}

/**
 * A price as a spreadsheet writes it: "12.99", "$12.99", "€12,99", "1,299.00" or "1.299,00".
 * Throws when it can't be read.
 */
export function readSheetPrice(input: string) {
  const s = input.replace(/^[^\d-]+|[^\d]+$/g, "").replace(/\s/g, "");
  // A comma with one or two digits after it, and no dot after it, is a decimal comma.
  const european = /^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(s);
  return parseMoney(european ? s.replace(/\./g, "").replace(",", ".") : s);
}

const DEFAULT_TITLES = new Set(["", "default", "default title"]);

/** Applies a prices and stock file to the store's products. Rows that can't be used are reported, not thrown. */
export async function importPrices(db: Db, shopId: string, text: string): Promise<PriceImportResult> {
  const rows = readPriceCsv(text);
  if (!rows.length) throw new UserError("That file has no products in it.");
  const products = await db.query.products.findMany({
    where: eq(schema.products.shopId, shopId),
    columns: { id: true, handle: true, sourceUrl: true, supplierId: true },
  });
  const variants = products.length
    ? await db.query.variants.findMany({ where: inArray(schema.variants.productId, products.map((p) => p.id)) })
    : [];
  const productOf = new Map(products.map((p) => [p.id, p]));
  const bySku = new Map<string, typeof variants>();
  for (const v of variants) if (v.sku?.trim()) bySku.set(v.sku.trim().toLowerCase(), [...(bySku.get(v.sku.trim().toLowerCase()) ?? []), v]);
  const byHandle = new Map(products.map((p) => [p.handle, variants.filter((v) => v.productId === p.id)]));

  const result: PriceImportResult = { changed: 0, unchanged: 0, skipped: [] };
  const done = new Set<string>();
  const counts: { variantId: string; counted: number }[] = [];
  for (const r of rows) {
    const ref = r.sku || [r.handle, r.variant].filter(Boolean).join(" / ");
    const skip = (reason: string) => result.skipped.push({ line: r.line, ref, reason });

    // Find the option: by SKU when there is one, else by Handle and Variant.
    let v: (typeof variants)[number] | undefined;
    if (r.sku) {
      const found = bySku.get(r.sku.toLowerCase()) ?? [];
      if (found.length > 1) {
        skip("More than one option has this SKU. Give each its own SKU, or leave SKU empty and use Handle and Variant.");
        continue;
      }
      v = found[0];
    }
    if (!v && r.handle) {
      const options = byHandle.get(r.handle);
      if (!options) {
        skip("There's no product with this handle.");
        continue;
      }
      v = options.find((o) => o.title.toLowerCase() === r.variant.toLowerCase()) ?? (options.length === 1 && DEFAULT_TITLES.has(r.variant.toLowerCase()) ? options[0] : undefined);
      if (!v) {
        skip(r.variant ? `This product has no option called "${r.variant}".` : "This product has several options. Say which in the Variant column.");
        continue;
      }
    }
    if (!v) {
      skip(r.sku ? "No option has this SKU." : "The SKU and handle are missing.");
      continue;
    }
    if (done.has(v.id)) {
      skip("This option is on an earlier line too, so this line was left out.");
      continue;
    }
    done.add(v.id);
    const product = productOf.get(v.productId)!;

    const money = (value: string, what: string) => {
      if (!value) return undefined;
      try {
        return readSheetPrice(value);
      } catch {
        skip(`The ${what} "${value}" isn't a price.`);
        return null;
      }
    };
    const price = money(r.price, "price");
    const compareAt = /^(-|none|0|0\.00)$/i.test(r.compareAt) ? 0 : money(r.compareAt, "compare at price");
    const cost = money(r.cost, "cost");
    if (price === null || compareAt === null || cost === null) continue;
    const set: Partial<typeof schema.variants.$inferInsert> = {};
    if (price !== undefined && price !== v.priceMinor) set.priceMinor = price;
    const newPrice = set.priceMinor ?? v.priceMinor;
    if (compareAt !== undefined) {
      // 0 or "-" takes the compare-at price off.
      const next = compareAt === 0 ? null : compareAt;
      if (next !== null && next <= newPrice) {
        skip("The compare at price must be higher than the price.");
        continue;
      }
      if (next !== v.compareAtMinor) set.compareAtMinor = next;
    } else if (set.priceMinor !== undefined && v.compareAtMinor !== null && v.compareAtMinor <= set.priceMinor) {
      // A new price at or above the old compare-at price would show a "sale" that isn't one.
      set.compareAtMinor = null;
    }
    if (cost !== undefined && cost !== v.costMinor) set.costMinor = cost;

    let stockChanged = false;
    if (r.stock) {
      const n = Number(r.stock.replace(/[,\s]/g, ""));
      if (!Number.isInteger(n) || n < 0 || n > 10_000_000) skip(`The stock "${r.stock}" isn't a whole number, so it wasn't changed.`);
      else if (n !== v.stock) {
        if (product.sourceUrl || product.supplierId) skip("Stock for supplier products comes from the supplier, so it wasn't changed.");
        else {
          counts.push({ variantId: v.id, counted: n });
          stockChanged = true;
        }
      }
    }
    if (Object.keys(set).length) await db.update(schema.variants).set(set).where(and(eq(schema.variants.id, v.id), eq(schema.variants.productId, product.id)));
    if (Object.keys(set).length || stockChanged) result.changed++;
    else result.unchanged++;
  }
  // Stock goes through the stock count, so the stock history says what changed.
  if (counts.length) await recordStockCount(db, shopId, counts);
  return result;
}
