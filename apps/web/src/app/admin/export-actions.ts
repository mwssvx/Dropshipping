"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { importStore, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type ImportState = { error?: string };

export async function importStoreAction(_: ImportState, form: FormData): Promise<ImportState> {
  const { shop, db } = await requireShop("export");
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose the store file you downloaded." };
  if (file.size > 10 * 1024 * 1024) return { error: "That file is over 10 MB." };
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return { error: "That file isn't a store file (it isn't valid JSON)." };
  }
  let currencyDiffers = false;
  try {
    currencyDiffers = (await importStore(db, shop.id, data)).currencyDiffers;
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin", "layout");
  // The page re-reads the store to say what arrived.
  redirect(`/admin/export?loaded=1${currencyDiffers ? "&currency=1" : ""}`);
}
