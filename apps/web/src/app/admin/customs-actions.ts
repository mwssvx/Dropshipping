"use server";
import { revalidatePath } from "next/cache";
import { setCustomsInfo, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type CustomsState = { error?: string; saved?: boolean };

/** Saves a product's HS code and the country it's made in, for customs forms on orders abroad. */
export async function customsAction(productId: string, _: CustomsState, form: FormData): Promise<CustomsState> {
  const { shop, db } = await requireShop("products");
  try {
    await setCustomsInfo(db, shop.id, productId, { hsCode: String(form.get("hsCode") ?? ""), originCountry: String(form.get("originCountry") ?? "") });
    revalidatePath(`/admin/products/${productId}`);
    return { saved: true };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
