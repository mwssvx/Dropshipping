"use server";
import { revalidatePath } from "next/cache";
import { setVariantContents, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type UnitPriceState = { error?: string; saved?: number };

/** Saves what each variant holds, for the price per unit on the store. */
export async function unitPriceAction(productId: string, _: UnitPriceState, form: FormData): Promise<UnitPriceState> {
  const { shop, db } = await requireShop("products");
  const rows = form.getAll("variant").map((v) => ({ variantId: String(v), amount: String(form.get(`amount-${v}`) ?? ""), unit: String(form.get(`unit-${v}`) ?? "") }));
  try {
    const saved = await setVariantContents(db, shop.id, productId, rows);
    revalidatePath(`/admin/products/${productId}`);
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { saved };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
