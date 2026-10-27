// Digital products: a file the buyer downloads instead of a parcel. The merchant uploads one file
// per product; once an order is paid, its confirmation email and order page link to the file.
// Each item bought can be downloaded a few times, so a shared link can't be passed around forever.
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";

/** Files go up through a server action, which takes up to 10 MB with the form around it. */
export const MAX_DIGITAL_FILE_BYTES = 8 * 1024 * 1024;
/** Downloads allowed for each item bought. */
export const DOWNLOADS_PER_ITEM = 5;

const PAID = ["paid", "partially_refunded"] as const;

/** A file name that's safe in a download header: no path, no control characters, at most 100 characters. */
export function cleanFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(-100);
  return clean || "download";
}

/** Attaches (or replaces) the file a product delivers, which makes it a digital product. */
export async function setDigitalFile(db: Db, shopId: string, productId: string, file: { name: string; contentType?: string; data: Buffer }) {
  const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)) });
  if (!product) throw new NotFoundError("Product");
  if (product.giftCard) throw new UserError("Gift cards are already sent by email.");
  if (product.supplierId) throw new UserError("This product comes from a supplier. Remove the supplier first: digital products are sent by you, as a download.");
  if (!file.data.length) throw new UserError("Pick a file to upload.");
  if (file.data.length > MAX_DIGITAL_FILE_BYTES) throw new UserError("Files can be up to 8 MB.");
  const values = { name: cleanFileName(file.name), contentType: file.contentType || "application/octet-stream", bytes: file.data.length, data: file.data };
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.digitalFiles)
      .values({ shopId, productId, ...values })
      .onConflictDoUpdate({ target: schema.digitalFiles.productId, set: { ...values, createdAt: new Date() } });
    // Nothing to ship, so nothing to count down or weigh either.
    await tx.update(schema.products).set({ digital: true, updatedAt: new Date() }).where(eq(schema.products.id, productId));
    await tx.update(schema.variants).set({ stock: null, weightGrams: null }).where(eq(schema.variants.productId, productId));
  });
  return digitalFileFor(db, productId);
}

/** Takes the file off: the product ships like any other again. Orders already paid keep their links working only while a file is attached. */
export async function removeDigitalFile(db: Db, shopId: string, productId: string) {
  const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)), columns: { id: true } });
  if (!product) throw new NotFoundError("Product");
  await db.transaction(async (tx) => {
    await tx.delete(schema.digitalFiles).where(eq(schema.digitalFiles.productId, productId));
    await tx.update(schema.products).set({ digital: false, updatedAt: new Date() }).where(eq(schema.products.id, productId));
  });
}

/** The product's file, without its contents, or null. */
export async function digitalFileFor(db: Db, productId: string) {
  const [row] = await db
    .select({ name: schema.digitalFiles.name, bytes: schema.digitalFiles.bytes, contentType: schema.digitalFiles.contentType, createdAt: schema.digitalFiles.createdAt })
    .from(schema.digitalFiles)
    .where(eq(schema.digitalFiles.productId, productId));
  return row ?? null;
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The downloads an order carries: one per line of a digital product, with what's left of each. */
export async function orderDownloads(db: Db, orderId: string) {
  const rows = await db
    .select({ line: schema.orderLines, file: { name: schema.digitalFiles.name, bytes: schema.digitalFiles.bytes } })
    .from(schema.orderLines)
    .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .innerJoin(schema.digitalFiles, eq(schema.digitalFiles.productId, schema.variants.productId))
    .where(eq(schema.orderLines.orderId, orderId))
    .orderBy(schema.orderLines.id);
  return rows.map(({ line, file }) => {
    const allowed = line.quantity * DOWNLOADS_PER_ITEM;
    return { lineId: line.id, title: line.title, fileName: file.name, bytes: file.bytes, used: line.downloads, allowed, left: Math.max(0, allowed - line.downloads) };
  });
}

/** True when every line of the order is a gift card or a download, so there's nothing to ship. */
export async function nothingToShip(db: Db, orderId: string) {
  const rows = await db
    .select({ giftCard: schema.products.giftCard, digital: schema.products.digital })
    .from(schema.orderLines)
    .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(eq(schema.orderLines.orderId, orderId));
  return rows.length > 0 && rows.every((r) => r.giftCard || r.digital);
}

/**
 * The buyer opened a download link from their order (found by its payment reference, as the
 * order page is). Counts the download and returns the file, or says why it can't be had.
 */
export async function takeDownload(db: Db, shopId: string, paymentIntentId: string, lineId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(lineId)) throw new NotFoundError("Download");
  const order = await db.query.orders.findFirst({
    where: and(eq(schema.orders.shopId, shopId), eq(schema.orders.paymentIntentId, paymentIntentId)),
    columns: { id: true, paymentStatus: true },
  });
  if (!order) throw new NotFoundError("Download");
  const [found] = await db
    .select({ line: schema.orderLines, fileId: schema.digitalFiles.id })
    .from(schema.orderLines)
    .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .innerJoin(schema.digitalFiles, eq(schema.digitalFiles.productId, schema.variants.productId))
    .where(and(eq(schema.orderLines.id, lineId), eq(schema.orderLines.orderId, order.id)));
  if (!found) throw new NotFoundError("Download");
  if (!(PAID as readonly string[]).includes(order.paymentStatus)) {
    throw new UserError(order.paymentStatus === "refunded" ? "This order was refunded, so its downloads are closed." : "Your download is ready once the order is paid.");
  }
  const allowed = found.line.quantity * DOWNLOADS_PER_ITEM;
  const [taken] = await db
    .update(schema.orderLines)
    .set({ downloads: sql`${schema.orderLines.downloads} + 1` })
    .where(and(eq(schema.orderLines.id, lineId), lt(schema.orderLines.downloads, allowed)))
    .returning({ downloads: schema.orderLines.downloads });
  if (!taken) throw new UserError(`You've downloaded this ${allowed} times, the most for this order. Reply to your order email and the store can help.`);
  const file = (await db.query.digitalFiles.findFirst({ where: eq(schema.digitalFiles.id, found.fileId) }))!;
  return { name: file.name, bytes: file.bytes, data: Buffer.from(file.data), left: allowed - taken.downloads };
}

/** The merchant gives a buyer their downloads back, e.g. after a new laptop. */
export async function resetDownloads(db: Db, shopId: string, orderId: string) {
  const order = await db.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId)), columns: { id: true } });
  if (!order) throw new NotFoundError("Order");
  const ids = (await orderDownloads(db, order.id)).map((d) => d.lineId);
  if (ids.length) await db.update(schema.orderLines).set({ downloads: 0 }).where(inArray(schema.orderLines.id, ids));
  return ids.length;
}
