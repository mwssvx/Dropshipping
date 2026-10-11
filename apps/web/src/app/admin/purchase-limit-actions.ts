"use server";
import { revalidatePath } from "next/cache";
import { setPurchaseLimit, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type PurchaseLimitState = { error?: string; saved?: boolean };

/** Saves the least and most a buyer can order of a product; empty boxes mean no limit. */
export async function purchaseLimitAction(productId: string, _: PurchaseLimitState, form: FormData): Promise<PurchaseLimitState> {
  const { shop, db } = await requireShop("products");
  const num = (name: string) => {
    const v = String(form.get(name) ?? "").trim();
    return v ? Number(v) : null;
  };
  try {
    const saved = await setPurchaseLimit(db, shop.id, productId, { min: num("min"), max: num("max"), perCustomer: num("perCustomer") });
    revalidatePath(`/admin/products/${productId}`);
    return { saved: !!saved };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
