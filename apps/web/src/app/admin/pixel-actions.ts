"use server";
import { revalidatePath } from "next/cache";
import { setAdPixels, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type PixelState = { error?: string; saved?: boolean };

/** Saves the store's Meta, TikTok and Google tags and who is asked before they load. */
export async function adPixelsAction(_: PixelState, form: FormData): Promise<PixelState> {
  const { shop, db } = await requireShop("marketing");
  const get = (k: string) => String(form.get(k) ?? "");
  try {
    const saved = await setAdPixels(db, shop.id, { meta: get("meta"), tiktok: get("tiktok"), google: get("google"), consent: get("consent") === "eu_uk" ? "eu_uk" : "everyone" });
    revalidatePath("/admin/channels");
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { saved: !!saved };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
