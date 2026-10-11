"use server";
import { revalidatePath } from "next/cache";
import { editProductPhotos, saveMedia, setPhotoTexts, setVariantPhotos, UserError, type PhotoEdit } from "@sf/core";
import { adminUrl, requireShop } from "@/lib/server";

export type PhotoState = { error?: string; message?: string; url?: string };

/** Every photo button on the product page: add (upload or address), remove, and reorder. */
export async function photoAction(productId: string, _: PhotoState, form: FormData): Promise<PhotoState> {
  const { shop, db } = await requireShop("products");
  const [op = "", at = ""] = String(form.get("op") ?? "").split(":");
  const index = Number(at);
  let edit: PhotoEdit;
  let message: string;
  try {
    if (op === "add") {
      const file = form.get("file");
      const url = String(form.get("url") ?? "").trim();
      if (file instanceof File && file.size > 0) {
        const { id } = await saveMedia(db, shop.id, Buffer.from(await file.arrayBuffer()));
        edit = { kind: "add", url: await adminUrl(`/api/media/${id}`) };
      } else if (url) {
        edit = { kind: "add", url };
      } else {
        return { error: "Choose a photo to upload, or paste its address." };
      }
      message = "Photo added.";
    } else if (op === "remove") {
      edit = { kind: "remove", index };
      message = "Photo removed.";
    } else if (op === "cover" || op === "earlier" || op === "later") {
      edit = { kind: "move", index, to: op };
      message = op === "cover" ? "That's the main photo now." : "Moved.";
    } else {
      return { error: "Something went wrong. Try again." };
    }
    await editProductPhotos(db, shop.id, productId, edit);
  } catch (e) {
    // Keep a typed address so it isn't lost when the form resets.
    if (e instanceof UserError) return { error: e.message, url: String(form.get("url") ?? "") };
    throw e;
  }
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath("/admin/products");
  revalidatePath(`/s/${shop.handle}`, "layout");
  return { message };
}

/** Saves which photo each option (each colour, usually) shows. Fields are photo:<value or variant id>. */
export async function variantPhotosAction(productId: string, option: string | null, _: PhotoState, form: FormData): Promise<PhotoState> {
  const { shop, db } = await requireShop("products");
  const photos: Record<string, string | null> = {};
  for (const [name, value] of form.entries()) {
    if (name.startsWith("photo:") && typeof value === "string") photos[name.slice(6)] = value || null;
  }
  try {
    await setVariantPhotos(db, shop.id, productId, option, photos);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath(`/s/${shop.handle}`, "layout");
  return { message: "Saved. Buyers see that photo when they pick it." };
}

export type PhotoTextState = { error?: string; described?: number };

/** Saves what each photo shows. Fields are text:<photo number>, one per photo in order. */
export async function photoTextAction(productId: string, count: number, _: PhotoTextState, form: FormData): Promise<PhotoTextState> {
  const { shop, db } = await requireShop("products");
  let described: number;
  try {
    described = await setPhotoTexts(db, shop.id, productId, Array.from({ length: count }, (_, i) => String(form.get(`text:${i}`) ?? "")));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath("/admin/seo");
  revalidatePath(`/s/${shop.handle}`, "layout");
  return { described };
}
