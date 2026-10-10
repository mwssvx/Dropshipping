// Product photos: each product keeps up to ten photos in order, cover first. The cover is also
// stored as products.image_url, which lists, carts, emails and search results read.
import { and, eq, inArray } from "drizzle-orm";
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
  // A removed photo stops being any option's photo.
  const gone = productPhotos(product).filter((u) => !cols.images.includes(u));
  if (gone.length) {
    await db.update(schema.variants).set({ imageUrl: null }).where(and(eq(schema.variants.productId, product.id), inArray(schema.variants.imageUrl, gone)));
  }
  return cols.images;
}

/**
 * A supplier's photos with the ones its variants use (a photo per colour, say) kept within the
 * limit: the cover first, then the variants' photos, then the rest of the supplier's.
 */
export function supplierPhotos(images: string[], variantImages: (string | null | undefined)[]) {
  const own = variantImages.filter((u): u is string => !!u && isPhotoUrl(u));
  const cols = photoColumns([...images.slice(0, 1), ...own, ...images.slice(1)]);
  return { ...cols, variantImage: (u: string | null | undefined) => (u && cols.images.includes(u) ? u : null) };
}

type PhotoVariant = { id: string; title: string; options: Record<string, string>; imageUrl: string | null };

/**
 * The option whose values each have their own photo (Color, usually), when there is one: every
 * variant with the same value shows the same photo, and at least one has a photo.
 */
export function photoOption(variants: PhotoVariant[]) {
  const names = [...new Set(variants.flatMap((v) => Object.keys(v.options)))];
  return (
    names.find((name) => {
      const seen = new Map<string, string | null>();
      for (const v of variants) {
        const value = v.options[name];
        if (value === undefined) return false;
        if (seen.has(value) && seen.get(value) !== v.imageUrl) return false;
        seen.set(value, v.imageUrl);
      }
      return [...seen.values()].some(Boolean);
    }) ?? null
  );
}

/** The photo a new combination should start with: the one its colour (say) already uses. */
export function inheritedPhoto(variants: PhotoVariant[], options: Record<string, string> | undefined) {
  const name = photoOption(variants);
  if (!name || !options?.[name]) return null;
  return variants.find((v) => v.options[name] === options[name])?.imageUrl ?? null;
}

/**
 * How the admin assigns photos: one row per value of an option (each colour), or one per variant
 * when the options don't split that way. The option picked is the one already used for photos,
 * else one called colour, else the first.
 */
export function variantPhotoRows(variants: PhotoVariant[]) {
  const names = [...new Set(variants.flatMap((v) => Object.keys(v.options)))];
  const option = photoOption(variants) ?? names.find((n) => /^colou?r$/i.test(n.trim())) ?? names[0] ?? null;
  if (option && variants.every((v) => v.options[option] !== undefined)) {
    const values = [...new Set(variants.map((v) => v.options[option]!))];
    if (values.length > 1) {
      return {
        option,
        rows: values.map((value) => {
          const urls = new Set(variants.filter((v) => v.options[option] === value).map((v) => v.imageUrl));
          return { key: value, label: value, url: urls.size === 1 ? [...urls][0]! : null };
        }),
      };
    }
  }
  return { option: null, rows: variants.map((v) => ({ key: v.id, label: v.title, url: v.imageUrl })) };
}

/**
 * Sets the photo buyers see when they pick an option. `option` set: keys are its values and every
 * variant with that value gets the photo. `option` null: keys are variant ids. A photo must already
 * be one of the product's photos; null clears it.
 */
export async function setVariantPhotos(db: Db, shopId: string, productId: string, option: string | null, photos: Record<string, string | null>) {
  const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)) });
  if (!product) throw new NotFoundError("Product");
  const allowed = productPhotos(product);
  const variants = await db.query.variants.findMany({ where: eq(schema.variants.productId, product.id) });
  let changed = 0;
  for (const [key, raw] of Object.entries(photos)) {
    const url = raw || null;
    if (url && !allowed.includes(url)) throw new UserError("Pick one of the product's photos.");
    const ids = variants.filter((v) => (option ? v.options[option] === key : v.id === key)).map((v) => v.id);
    if (!ids.length) throw new UserError("One of those options was removed meanwhile. Reload the page and try again.");
    const rows = await db.update(schema.variants).set({ imageUrl: url }).where(inArray(schema.variants.id, ids)).returning({ id: schema.variants.id });
    changed += rows.length;
  }
  if (changed) await db.update(schema.products).set({ updatedAt: new Date() }).where(eq(schema.products.id, product.id));
  return changed;
}
