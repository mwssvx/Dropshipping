"use server";
import { revalidatePath } from "next/cache";
import { setProductSeo, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type SeoState = { error?: string; saved?: boolean };

/** Saves a product's search title and description. */
export async function productSeoAction(productId: string, _: SeoState, form: FormData): Promise<SeoState> {
  const { shop, db } = await requireShop("products");
  try {
    await setProductSeo(db, shop.id, productId, { title: String(form.get("seoTitle") ?? ""), description: String(form.get("seoDescription") ?? "") });
    revalidatePath(`/admin/products/${productId}`);
    revalidatePath("/admin/seo");
    return { saved: true };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
