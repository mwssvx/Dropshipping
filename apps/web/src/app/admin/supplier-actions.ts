"use server";
import { revalidatePath } from "next/cache";
import { addOwnSupplier, removeOwnSupplier, resetSupplierLink, setProductSupplier, updateOwnSupplier, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";
import type { FormState } from "./actions";

const read = (form: FormData) => ({ name: String(form.get("name") ?? ""), email: String(form.get("email") ?? "") });

async function attempt(fn: () => Promise<unknown>): Promise<FormState> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/suppliers");
  return { saved: true };
}

export async function addOwnSupplierAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("suppliers");
  return attempt(() => addOwnSupplier(db, shop.id, read(form)));
}

export async function updateOwnSupplierAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("suppliers");
  return attempt(() => updateOwnSupplier(db, shop.id, id, read(form)));
}

export async function removeOwnSupplierAction(id: string, _: FormState, _form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("suppliers");
  return attempt(() => removeOwnSupplier(db, shop.id, id));
}

export async function resetSupplierLinkAction(id: string, _: FormState, _form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("suppliers");
  return attempt(() => resetSupplierLink(db, shop.id, id));
}

/** "api" keeps the product with its API supplier. */
export async function setProductSupplierAction(productId: string, form: FormData) {
  const { shop, db } = await requireShop("products");
  const id = String(form.get("supplierId") ?? "");
  if (id === "api") return;
  await setProductSupplier(db, shop.id, productId, id || null);
  revalidatePath(`/admin/products/${productId}`);
}
