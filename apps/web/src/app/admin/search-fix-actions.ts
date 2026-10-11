"use server";
import { revalidatePath } from "next/cache";
import { removeSearchFix, setSearchFix, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type SearchFixState = { error?: string; saved?: string };

/** Points a search at other words. */
export async function searchFixAction(_: SearchFixState, form: FormData): Promise<SearchFixState> {
  const { shop, db } = await requireShop("products");
  const from = String(form.get("from") ?? "");
  try {
    await setSearchFix(db, shop.id, { from, to: String(form.get("to") ?? "") });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/search-fixes");
  revalidatePath(`/s/${shop.handle}`, "layout");
  return { saved: from.toLowerCase().replace(/\s+/g, " ").trim() };
}

export async function removeSearchFixAction(from: string) {
  const { shop, db } = await requireShop("products");
  await removeSearchFix(db, shop.id, from);
  revalidatePath("/admin/search-fixes");
  revalidatePath(`/s/${shop.handle}`, "layout");
}
