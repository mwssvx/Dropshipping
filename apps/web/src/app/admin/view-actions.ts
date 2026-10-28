"use server";
import { revalidatePath } from "next/cache";
import { deleteSavedView, saveView, UserError, VIEW_PARAMS, type SavedViewList } from "@sf/core";
import { requireShop } from "@/lib/server";

export type SaveViewState = { error?: string; done?: string };

/** Saved views are kept by whoever can see the list. */
const PERMISSION = { products: "products", orders: "orders", customers: "customers" } as const;

export async function saveViewAction(list: SavedViewList, _: SaveViewState, form: FormData): Promise<SaveViewState> {
  const { shop, db } = await requireShop(PERMISSION[list]);
  const params = Object.fromEntries(VIEW_PARAMS[list].map((k) => [k, form.get(`view-${k}`)?.toString()]));
  try {
    const view = await saveView(db, shop.id, list, { name: String(form.get("name") ?? ""), params });
    revalidatePath(`/admin/${list}`);
    return { done: `Saved as “${view.name}”` };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export async function deleteViewAction(list: SavedViewList, viewId: string) {
  const { shop, db } = await requireShop(PERMISSION[list]);
  await deleteSavedView(db, shop.id, viewId);
  revalidatePath(`/admin/${list}`);
}
