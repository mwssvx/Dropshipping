"use server";
import { revalidatePath } from "next/cache";
import { setProductVideo, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type VideoState = { error?: string; saved?: boolean };

/** Saves the product page's video link, or removes it when the box is empty. */
export async function productVideoAction(productId: string, _: VideoState, form: FormData): Promise<VideoState> {
  const { shop, db } = await requireShop("products");
  try {
    const saved = await setProductVideo(db, shop.id, productId, String(form.get("video") ?? ""));
    revalidatePath(`/admin/products/${productId}`);
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { saved: !!saved };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
