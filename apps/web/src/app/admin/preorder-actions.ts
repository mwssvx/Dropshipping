"use server";
import { revalidatePath } from "next/cache";
import { setPreorder, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type PreorderState = { error?: string; saved?: boolean };

/** Turns pre-orders on (with a ship-by date and an optional limit) or off for a product. */
export async function preorderAction(productId: string, _: PreorderState, form: FormData): Promise<PreorderState> {
  const { shop, db } = await requireShop("products");
  const on = form.get("enabled") === "on";
  const limit = String(form.get("limit") ?? "").trim();
  try {
    const saved = await setPreorder(db, shop.id, productId, on ? { shipsBy: String(form.get("shipsBy") ?? ""), limit: limit ? Number(limit) : null } : null);
    revalidatePath(`/admin/products/${productId}`);
    return { saved: !!saved };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
