// Product photos: each product keeps up to ten photos in order, cover first. The cover is also
// stored as products.image_url, which lists, carts, emails and search results read.
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";

export const MAX_PHOTOS = 10;

/** Our own uploads live at /api/media/<id>, which is http in development; anything else must be https. */
const OWN_MEDIA = /^https?:\/\/[^/\s]+\/api\/media\/[0-9a-f-]{36}$/i;

export function isPhotoUrl(url: string) {
  if (OWN_MEDIA.test(url)) return true;
  try {
    return new URL(url).protocol === "https:" && url.length <= 2000;
  } catch {
    return false;
  }
}

/** The columns to save for a photo list: invalid and repeated addresses dropped, ten at most. */
export function photoColumns(urls: string[]) {
  const images = [...new Set(urls.map((u) => u.trim()).filter(isPhotoUrl))].slice(0, MAX_PHOTOS);
  return { images, imageUrl: images[0] ?? null };
}

/** A product's photos, also for rows saved before galleries (cover only). */
export function productPhotos(p: { images: string[]; imageUrl: string | null }) {
  return p.images.length ? p.images : p.imageUrl ? [p.imageUrl] : [];
}

export type PhotoEdit =
  | { kind: "add"; url: string; cover?: boolean }
  | { kind: "remove"; index: number }
  | { kind: "move"; index: number; to: "cover" | "earlier" | "later" };

/** Adds, removes or reorders one photo. Returns the new list. */
export async function editProductPhotos(db: Db, shopId: string, productId: string, edit: PhotoEdit) {
  const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)) });
  if (!product) throw new NotFoundError("Product");
  const photos = [...productPhotos(product)];
  if (edit.kind === "add") {
    const url = edit.url.trim();
    if (!isPhotoUrl(url)) throw new UserError("Use a full https address for the photo.");
    const without = photos.filter((p) => p !== url);
    if (without.length >= MAX_PHOTOS) throw new UserError(`A product can have up to ${MAX_PHOTOS} photos. Remove one first.`);
    if (edit.cover) without.unshift(url);
    else without.push(url);
    photos.splice(0, photos.length, ...without);
  } else {
    const i = edit.index;
    if (!Number.isInteger(i) || i < 0 || i >= photos.length) throw new UserError("That photo isn't there any more.");
    const [photo] = photos.splice(i, 1);
    if (edit.kind === "move") {
      const to = edit.to === "cover" ? 0 : edit.to === "earlier" ? Math.max(0, i - 1) : Math.min(photos.length, i + 1);
      photos.splice(to, 0, photo!);
    }
  }
  const cols = photoColumns(photos);
  await db.update(schema.products).set({ ...cols, updatedAt: new Date() }).where(eq(schema.products.id, product.id));
  return cols.images;
}
