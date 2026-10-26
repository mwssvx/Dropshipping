"use server";
import { revalidatePath } from "next/cache";
import { setProductDetails, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type DetailsState = { error?: string; saved?: number };

/** Saves the product page's details table, or removes it when the box is empty. */
export async function productDetailsAction(productId: string, _: DetailsState, form: FormData): Promise<DetailsState> {
  const { shop, db } = await requireShop("products");
  try {
    const saved = await setProductDetails(db, shop.id, productId, String(form.get("details") ?? ""));
    revalidatePath(`/admin/products/${productId}`);
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { saved: saved.length };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
