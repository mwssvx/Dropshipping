"use server";
import { revalidatePath } from "next/cache";
import { importShopifyCustomers, importShopifyProducts, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type ShopifyImportState = { error?: string; created?: number; skipped?: string[]; problems?: string[] };

/** Adds the products in a Shopify products file. */
export async function shopifyImportAction(_: ShopifyImportState, form: FormData): Promise<ShopifyImportState> {
  const { shop, db } = await requireShop("products");
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose the products file you exported from Shopify." };
  if (file.size > 10 * 1024 * 1024) return { error: "That file is over 10 MB. Export fewer products at a time, like one collection." };
  try {
    const result = await importShopifyProducts(db, shop.id, await file.text(), { keepStatus: form.get("keepStatus") === "on" });
    revalidatePath("/admin/products");
    revalidatePath(`/s/${shop.handle}`, "layout");
    return result;
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export type ShopifyCustomersState = { error?: string; added?: number; updated?: number; subscribed?: number; invalid?: number };

/** Adds the customers in a Shopify customers file. */
export async function shopifyCustomersAction(_: ShopifyCustomersState, form: FormData): Promise<ShopifyCustomersState> {
  const { shop, db } = await requireShop("customers");
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose the customers file you exported from Shopify." };
  if (file.size > 10 * 1024 * 1024) return { error: "That file is over 10 MB. Export fewer customers at a time." };
  try {
    const result = await importShopifyCustomers(db, shop.id, await file.text());
    revalidatePath("/admin/customers");
    return result;
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
